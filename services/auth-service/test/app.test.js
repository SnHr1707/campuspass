'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { newDb } = require('pg-mem');
const { createApp, migrate, roleFromInvite } = require('../src/app');

const config = {
  jwtSecret: 'test-secret-that-is-at-least-32-characters-long',
  organiserCode: 'ORG-CODE',
  volunteerCode: 'VOL-CODE',
  bcryptRounds: 4,
};

async function buildApp() {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const db = new Pool();
  await migrate(db);
  return createApp({ db, config, newId: () => crypto.randomUUID() });
}

describe('auth-service', () => {
  let app;
  beforeEach(async () => {
    app = await buildApp();
  });

  test('refuses to start with a short JWT secret', () => {
    expect(() => createApp({ db: {}, config: { jwtSecret: 'short' }, newId: () => 'x' })).toThrow(/JWT_SECRET/);
  });

  test('registers a student and returns a token', async () => {
    const res = await request(app)
      .post('/register')
      .send({ name: 'Asha', email: 'Asha@Nirma.edu', password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toMatchObject({ name: 'Asha', email: 'asha@nirma.edu', role: 'student' });
    expect(res.body.user.password_hash).toBeUndefined();
  });

  test('rejects duplicate emails', async () => {
    const body = { name: 'A', email: 'dup@nirma.edu', password: 'password123' };
    await request(app).post('/register').send(body).expect(201);
    const res = await request(app).post('/register').send(body);
    expect(res.status).toBe(409);
  });

  test.each([
    [{ email: 'a@b.co', password: 'password123' }, 'Name'],
    [{ name: 'A', email: 'not-an-email', password: 'password123' }, 'email'],
    [{ name: 'A', email: 'a@b.co', password: 'short' }, 'Password'],
  ])('validates input %#', async (body, word) => {
    const res = await request(app).post('/register').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(new RegExp(word, 'i'));
  });

  test('invite codes grant organiser and volunteer roles', () => {
    expect(roleFromInvite('ORG-CODE', config)).toBe('organiser');
    expect(roleFromInvite('VOL-CODE', config)).toBe('volunteer');
    expect(roleFromInvite('wrong', config)).toBe('student');
    expect(roleFromInvite(undefined, config)).toBe('student');
  });

  test('logs in with the right password only', async () => {
    await request(app).post('/register').send({ name: 'B', email: 'b@nirma.edu', password: 'password123' });
    const ok = await request(app).post('/login').send({ email: 'b@nirma.edu', password: 'password123' });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    const bad = await request(app).post('/login').send({ email: 'b@nirma.edu', password: 'wrongpass1' });
    expect(bad.status).toBe(401);
    const missing = await request(app).post('/login').send({ email: 'nobody@nirma.edu', password: 'password123' });
    expect(missing.status).toBe(401);
  });

  test('/verify returns identity headers for a valid token', async () => {
    const reg = await request(app)
      .post('/register')
      .send({ name: 'Ravi Patel', email: 'ravi@nirma.edu', password: 'password123', inviteCode: 'VOL-CODE' });
    const res = await request(app).get('/verify').set('Authorization', `Bearer ${reg.body.token}`);
    expect(res.status).toBe(200);
    expect(res.headers['x-user-id']).toBe(reg.body.user.id);
    expect(res.headers['x-user-role']).toBe('volunteer');
    expect(decodeURIComponent(res.headers['x-user-name'])).toBe('Ravi Patel');
  });

  test('/verify?optional=1 allows anonymous requests but still rejects bad tokens', async () => {
    const anon = await request(app).get('/verify?optional=1');
    expect(anon.status).toBe(200);
    expect(anon.headers['x-user-id']).toBeUndefined();
    await request(app).get('/verify?optional=1').set('Authorization', 'Bearer nonsense').expect(401);
  });

  test('/verify rejects missing and tampered tokens', async () => {
    await request(app).get('/verify').expect(401);
    const reg = await request(app).post('/register').send({ name: 'C', email: 'c@nirma.edu', password: 'password123' });
    const tampered = `${reg.body.token.slice(0, -2)}xx`;
    await request(app).get('/verify').set('Authorization', `Bearer ${tampered}`).expect(401);
  });

  test('/me returns the current user', async () => {
    const reg = await request(app).post('/register').send({ name: 'D', email: 'd@nirma.edu', password: 'password123' });
    const res = await request(app).get('/me').set('Authorization', `Bearer ${reg.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('d@nirma.edu');
  });

  test('health and metrics endpoints respond', async () => {
    await request(app).get('/health').expect(200);
    const m = await request(app).get('/metrics');
    expect(m.status).toBe(200);
    expect(m.text).toContain('process_cpu_user_seconds_total');
  });

  test('bad JSON gives 400, unknown route gives 404', async () => {
    await request(app).post('/login').set('Content-Type', 'application/json').send('{bad').expect(400);
    await request(app).get('/nope').expect(404);
  });
});
