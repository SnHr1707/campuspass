'use strict';

// Seat bookkeeping in Redis. PostgreSQL is the source of truth for bookings;
// Redis holds a fast counter so thousands of concurrent requests never oversell.

// Runs atomically inside Redis: no other command can run between the check and the decrement.
// Returns: seats left after booking (>= 0), -1 sold out, -2 already booked, -3 not initialised.
const RESERVE_SCRIPT = `
if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then return -2 end
local left = redis.call('GET', KEYS[1])
if not left then return -3 end
left = tonumber(left)
if left <= 0 then return -1 end
redis.call('DECR', KEYS[1])
redis.call('SADD', KEYS[2], ARGV[1])
return left - 1
`;

// Undo a reservation when a later step (database write, ticket issue) fails.
const RELEASE_SCRIPT = `
if redis.call('SREM', KEYS[2], ARGV[1]) == 1 then
  return redis.call('INCR', KEYS[1])
end
return -1
`;

const keys = (eventId) => ({
  seats: `seats:{${eventId}}`,
  booked: `booked:{${eventId}}`,
  capacity: `capacity:{${eventId}}`,
});

function createSeatStore(redis) {
  redis.defineCommand('reserveSeat', { numberOfKeys: 2, lua: RESERVE_SCRIPT });
  redis.defineCommand('releaseSeat', { numberOfKeys: 2, lua: RELEASE_SCRIPT });

  return {
    // Builds the counter from PostgreSQL, so a Redis restart can never cause overselling.
    async initialise(eventId, capacity, bookedUserIds) {
      const k = keys(eventId);
      if (await redis.exists(k.seats)) return false;
      if (bookedUserIds.length) await redis.sadd(k.booked, ...bookedUserIds);
      await redis.set(k.capacity, capacity);
      const created = await redis.set(k.seats, Math.max(capacity - bookedUserIds.length, 0), 'NX');
      return created === 'OK';
    },

    async reserve(eventId, userId) {
      const k = keys(eventId);
      return Number(await redis.reserveSeat(k.seats, k.booked, userId));
    },

    async release(eventId, userId) {
      const k = keys(eventId);
      return Number(await redis.releaseSeat(k.seats, k.booked, userId));
    },

    async available(eventIds) {
      if (!eventIds.length) return {};
      const values = await redis.mget(...eventIds.map((id) => keys(id).seats));
      return Object.fromEntries(eventIds.map((id, i) => [id, values[i] === null ? null : Number(values[i])]));
    },

    async stats(eventId) {
      const k = keys(eventId);
      const [left, capacity] = await redis.mget(k.seats, k.capacity);
      if (left === null) return null;
      return { capacity: Number(capacity), left: Number(left), sold: Number(capacity) - Number(left) };
    },

    // Used by the metrics endpoint to report seats left for every active event.
    async allSeatCounts(limit = 50) {
      const out = {};
      let cursor = '0';
      do {
        // eslint-disable-next-line no-await-in-loop
        const [next, found] = await redis.scan(cursor, 'MATCH', 'seats:*', 'COUNT', 100);
        cursor = next;
        for (const key of found) {
          if (Object.keys(out).length >= limit) break;
          out[key.slice(7, -1)] = null;
        }
      } while (cursor !== '0' && Object.keys(out).length < limit);
      return this.available(Object.keys(out));
    },
  };
}

module.exports = { createSeatStore, RESERVE_SCRIPT, RELEASE_SCRIPT, keys };
