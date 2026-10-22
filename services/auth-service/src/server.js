'use strict';

const crypto = require('node:crypto');
const { Pool } = require('pg');
const pino = require('pino');
const pinoHttp = require('pino-http');
const { createApp, migrate } = require('./app');

const log = pino({ level: process.env.LOG_LEVEL || 'info', base: { service: 'auth-service' } });

const config = {
  port: Number(process.env.PORT || 3001),
  jwtSecret: process.env.JWT_SECRET,
  jwtTtl: process.env.JWT_TTL || '12h',
  organiserCode: process.env.ORGANISER_INVITE_CODE,
  volunteerCode: process.env.VOLUNTEER_INVITE_CODE,
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 10),
};

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_SIZE || 10),
});

async function connectWithRetry(attempts = 30) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await migrate(db);
      return;
    } catch (err) {
      log.warn({ attempt: i, err: err.message }, 'database not ready, retrying in 2s');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('Could not connect to the database');
}

async function main() {
  await connectWithRetry();
  const logger = pinoHttp({
    logger: log,
    genReqId: (req) => req.headers['x-request-id'] || crypto.randomUUID(),
    autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/metrics' },
  });
  const app = createApp({ db, config, logger, newId: () => crypto.randomUUID() });
  const server = app.listen(config.port, () => log.info({ port: config.port }, 'auth-service listening'));

  // Graceful shutdown so Kubernetes rolling updates do not drop requests.
  const shutdown = () => {
    log.info('shutting down');
    server.close(() => db.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  log.fatal({ err }, 'failed to start');
  process.exit(1);
});
