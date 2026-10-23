'use strict';

const express = require('express');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { metricsMiddleware, register } = require('./metrics');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ROLES = ['student', 'organiser', 'volunteer'];

// Creates the users table if it does not exist. Each service owns its own schema.
async function migrate(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY,
      name          VARCHAR(80)  NOT NULL,
      email         VARCHAR(160) NOT NULL UNIQUE,
      password_hash VARCHAR(100) NOT NULL,
      role          VARCHAR(20)  NOT NULL,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
    )`);
}

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

// An invite code turns a normal sign-up into an organiser or volunteer account.
function roleFromInvite(inviteCode, config) {
  if (inviteCode && config.organiserCode && inviteCode === config.organiserCode) return 'organiser';
  if (inviteCode && config.volunteerCode && inviteCode === config.volunteerCode) return 'volunteer';
  return 'student';
}

function bearerToken(req) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

function createApp({ db, config, logger, newId }) {
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long');
  }

  const dummyHash = bcrypt.hashSync('not-a-real-password', config.bcryptRounds || 10);
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));
  if (logger) app.use(logger);
  app.use(metricsMiddleware);

  const sign = (user) =>
    jwt.sign({ sub: user.id, role: user.role, name: user.name, email: user.email }, config.jwtSecret, {
      expiresIn: config.jwtTtl || '12h',
      issuer: 'campuspass-auth',
    });

  const verify = (token) => jwt.verify(token, config.jwtSecret, { issuer: 'campuspass-auth' });

  app.post('/register', async (req, res, next) => {
    try {
      const { name, email, password, inviteCode } = req.body || {};
      const cleanName = typeof name === 'string' ? name.trim() : '';
      const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
      if (!cleanName || cleanName.length > 80) return res.status(400).json({ error: 'Name is required (max 80 characters)' });
      if (!EMAIL_RE.test(cleanEmail) || cleanEmail.length > 160) return res.status(400).json({ error: 'A valid email is required' });
      if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
        return res.status(400).json({ error: 'Password must be 8 to 72 characters' });
      }

      const user = {
        id: newId(),
        name: cleanName,
        email: cleanEmail,
        role: roleFromInvite(inviteCode, config),
      };
      const hash = await bcrypt.hash(password, config.bcryptRounds || 10);
      try {
        await db.query(
          'INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)',
          [user.id, user.name, user.email, hash, user.role],
        );
      } catch (err) {
        if (err.code === '23505' || /duplicate|unique/i.test(err.message)) {
          return res.status(409).json({ error: 'An account with this email already exists' });
        }
        throw err;
      }
      return res.status(201).json({ token: sign(user), user });
    } catch (err) {
      return next(err);
    }
  });

  app.post('/login', async (req, res, next) => {
    try {
      const { email, password } = req.body || {};
      if (typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'Email and password are required' });
      }
      const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
      const row = rows[0];
      // Compare even when the user is missing, so response time does not reveal which emails exist.
      const ok = await bcrypt.compare(password, row ? row.password_hash : dummyHash);
      if (!row || !ok) return res.status(401).json({ error: 'Wrong email or password' });
      const user = publicUser(row);
      return res.json({ token: sign(user), user });
    } catch (err) {
      return next(err);
    }
  });

  app.get('/me', async (req, res, next) => {
    try {
      const token = bearerToken(req);
      if (!token) return res.status(401).json({ error: 'Missing token' });
      let claims;
      try {
        claims = verify(token);
      } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [claims.sub]);
      if (!rows[0]) return res.status(404).json({ error: 'User not found' });
      return res.json(publicUser(rows[0]));
    } catch (err) {
      return next(err);
    }
  });

  // Called by the NGINX gateway (auth_request) for every API route.
  // Stateless: it only checks the JWT signature, so it stays fast under load.
  // ?optional=1 is used for public routes: no token is fine, a bad token is not.
  app.get('/verify', (req, res) => {
    const token = bearerToken(req);
    if (!token) return res.status(req.query.optional === '1' ? 200 : 401).end();
    try {
      const claims = verify(token);
      if (!ROLES.includes(claims.role)) return res.status(401).end();
      res.set('X-User-Id', claims.sub);
      res.set('X-User-Role', claims.role);
      res.set('X-User-Name', encodeURIComponent(claims.name || ''));
      return res.status(200).end();
    } catch {
      return res.status(401).end();
    }
  });

  app.get('/health', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', service: 'auth-service' });
    } catch {
      res.status(503).json({ status: 'down', service: 'auth-service' });
    }
  });

  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', register.contentType);
    res.send(await register.metrics());
  });

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    (req.log || console).error({ err }, 'unhandled error');
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp, migrate, roleFromInvite };
