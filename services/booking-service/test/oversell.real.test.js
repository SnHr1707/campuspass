'use strict';

// Runs against a real Redis server (set REDIS_TEST_URL). CI starts one as a service container.
// Proves the Lua script never oversells, even with 500 truly concurrent clients.

const crypto = require('node:crypto');
const Redis = require('ioredis');
const { createSeatStore } = require('../src/seats');

const url = process.env.REDIS_TEST_URL;
const maybe = url ? describe : describe.skip;

maybe('seat reservation against real Redis', () => {
  const clients = [];
  afterAll(async () => {
    await Promise.all(clients.map((c) => c.quit()));
  });

  test('500 concurrent students, 100 seats: exactly 100 succeed', async () => {
    const eventId = crypto.randomBytes(12).toString('hex');
    // Many separate connections, like many booking-service pods.
    for (let i = 0; i < 10; i += 1) clients.push(new Redis(url));
    const stores = clients.map(createSeatStore);
    await stores[0].initialise(eventId, 100, []);

    const results = await Promise.all(
      Array.from({ length: 500 }, (_, i) => stores[i % stores.length].reserve(eventId, crypto.randomUUID())),
    );
    expect(results.filter((r) => r >= 0)).toHaveLength(100);
    expect(results.filter((r) => r === -1)).toHaveLength(400);
    expect(await stores[0].available([eventId])).toEqual({ [eventId]: 0 });
  });
});
