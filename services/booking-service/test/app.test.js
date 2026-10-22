'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { newDb } = require('pg-mem');
const RedisMock = require('ioredis-mock');
const { createApp, migrate } = require('../src/app');
const { createSeatStore } = require('../src/seats');

const EVENT_ID = 'a'.repeat(24);
const future = new Date(Date.now() + 86400000).toISOString();

async function setup({ capacity = 2, ticketFails = false, startsAt = future } = {}) {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const db = new Pool();
  await migrate(db);
  const redis = new RedisMock({ port: 6390 });
  await redis.flushall();
  const seats = createSeatStore(redis);
  const events = {
    get: async (id) => (id === EVENT_ID ? { id, title: 'Tech Fest Keynote', capacity, startsAt, venue: 'Main Hall' } : null),
  };
  const issued = [];
  const tickets = {
    issue: async (payload) => {
      if (ticketFails) {
        const err = new Error('ticket-service down');
        err.status = 503;
        throw err;
      }
      issued.push(payload);
      return { id: crypto.randomUUID(), token: 'CP1.x.y.z' };
    },
  };
  const app = createApp({ db, seats, events, tickets, newId: () => crypto.randomUUID() });
  return { app, db, seats, issued };
}

const asUser = (req, id, role = 'student') =>
  req.set('X-User-Id', id).set('X-User-Role', role).set('X-User-Name', encodeURIComponent('Test User'));

describe('booking-service', () => {
  test('requires the gateway identity header', async () => {
    const { app } = await setup();
    await request(app).post('/bookings').send({ eventId: EVENT_ID }).expect(401);
  });

  test('validates the event id', async () => {
    const { app } = await setup();
    await asUser(request(app).post('/bookings'), crypto.randomUUID()).send({ eventId: 'bad id' }).expect(400);
    await asUser(request(app).post('/bookings'), crypto.randomUUID()).send({ eventId: 'b'.repeat(24) }).expect(404);
  });

  test('books a seat and issues a ticket', async () => {
    const { app, issued } = await setup();
    const userId = crypto.randomUUID();
    const res = await asUser(request(app).post('/bookings'), userId).send({ eventId: EVENT_ID });
    expect(res.status).toBe(201);
    expect(res.body.seatsLeft).toBe(1);
    expect(res.body.ticket.id).toBeTruthy();
    expect(issued[0]).toMatchObject({ eventId: EVENT_ID, userId, holderName: 'Test User' });

    const mine = await asUser(request(app).get('/bookings/me'), userId);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].eventTitle).toBe('Tech Fest Keynote');
  });

  test('a student cannot book the same event twice', async () => {
    const { app } = await setup();
    const userId = crypto.randomUUID();
    await asUser(request(app).post('/bookings'), userId).send({ eventId: EVENT_ID }).expect(201);
    const again = await asUser(request(app).post('/bookings'), userId).send({ eventId: EVENT_ID });
    expect(again.status).toBe(409);
  });

  test('never sells more seats than capacity', async () => {
    const { app, db } = await setup({ capacity: 3 });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => asUser(request(app).post('/bookings'), crypto.randomUUID()).send({ eventId: EVENT_ID })),
    );
    const codes = results.map((r) => r.status);
    expect(codes.filter((c) => c === 201)).toHaveLength(3);
    expect(codes.filter((c) => c === 409)).toHaveLength(7);
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM bookings');
    expect(rows[0].n).toBe(3);
  });

  test('releases the seat if the ticket service fails', async () => {
    const { app, db, seats } = await setup({ capacity: 1, ticketFails: true });
    const res = await asUser(request(app).post('/bookings'), crypto.randomUUID()).send({ eventId: EVENT_ID });
    expect(res.status).toBe(503);
    expect(await seats.available([EVENT_ID])).toEqual({ [EVENT_ID]: 1 });
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM bookings');
    expect(rows[0].n).toBe(0);
  });

  test('rebuilds the seat counter from PostgreSQL after a Redis wipe', async () => {
    const { app, db, seats } = await setup({ capacity: 2 });
    const first = crypto.randomUUID();
    await asUser(request(app).post('/bookings'), first).send({ eventId: EVENT_ID }).expect(201);
    // Simulate losing Redis data: bookings remain in PostgreSQL.
    const redisLost = createSeatStore(new RedisMock({ port: 6391 }));
    expect(await redisLost.available([EVENT_ID])).toEqual({ [EVENT_ID]: null });
    await redisLost.initialise(EVENT_ID, 2, [first]);
    expect(await redisLost.reserve(EVENT_ID, first)).toBe(-2);
    expect(await redisLost.available([EVENT_ID])).toEqual({ [EVENT_ID]: 1 });
    expect(seats).toBeDefined();
  });

  test('refuses bookings for events that already started', async () => {
    const { app } = await setup({ startsAt: new Date(Date.now() - 1000).toISOString() });
    await asUser(request(app).post('/bookings'), crypto.randomUUID()).send({ eventId: EVENT_ID }).expect(410);
  });

  test('availability and stats', async () => {
    const { app } = await setup({ capacity: 5 });
    await asUser(request(app).post('/bookings'), crypto.randomUUID()).send({ eventId: EVENT_ID }).expect(201);
    const avail = await request(app).get(`/bookings/availability?eventIds=${EVENT_ID},bad`);
    expect(avail.body).toEqual({ [EVENT_ID]: 4 });
    await asUser(request(app).get(`/bookings/events/${EVENT_ID}/stats`), crypto.randomUUID()).expect(403);
    const stats = await asUser(request(app).get(`/bookings/events/${EVENT_ID}/stats`), crypto.randomUUID(), 'organiser');
    expect(stats.body).toMatchObject({ bookings: 1, capacity: 5, left: 4, sold: 1 });
  });

  test('health and metrics', async () => {
    const { app } = await setup();
    await request(app).get('/health').expect(200);
    const m = await request(app).get('/metrics');
    expect(m.text).toContain('campuspass_bookings_total');
  });
});
