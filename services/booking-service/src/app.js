'use strict';

const express = require('express');
const helmet = require('helmet');
const { metricsMiddleware, register, bookingsTotal } = require('./metrics');

const EVENT_ID_RE = /^[a-f0-9]{24}$/; // MongoDB ObjectId, also stops odd characters reaching Redis keys

async function migrate(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id          UUID PRIMARY KEY,
      event_id    VARCHAR(24)  NOT NULL,
      event_title VARCHAR(160) NOT NULL,
      user_id     UUID         NOT NULL,
      ticket_id   UUID,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
      CONSTRAINT one_booking_per_user UNIQUE (event_id, user_id)
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS bookings_user_idx ON bookings (user_id)');
}

// Identity comes from the API gateway, which verified the JWT and set these headers.
// Services are only reachable inside the cluster (NetworkPolicy), so clients cannot forge them.
function identity(req) {
  const id = req.get('x-user-id');
  if (!id) return null;
  let name = '';
  try {
    name = decodeURIComponent(req.get('x-user-name') || '');
  } catch {
    name = '';
  }
  return { id, role: req.get('x-user-role') || 'student', name };
}

function createApp({ db, seats, events, tickets, logger, newId }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));
  if (logger) app.use(logger);
  app.use(metricsMiddleware);

  async function ensureSeatsInitialised(event) {
    const { rows } = await db.query('SELECT user_id FROM bookings WHERE event_id = $1', [event.id]);
    await seats.initialise(event.id, Number(event.capacity), rows.map((r) => r.user_id));
  }

  app.post('/bookings', async (req, res, next) => {
    const user = identity(req);
    if (!user) return res.status(401).json({ error: 'Login required' });
    const { eventId } = req.body || {};
    if (typeof eventId !== 'string' || !EVENT_ID_RE.test(eventId)) {
      return res.status(400).json({ error: 'A valid eventId is required' });
    }

    let reserved = false;
    let bookingId = null;
    try {
      const event = await events.get(eventId, req.id);
      if (!event) return res.status(404).json({ error: 'Event not found' });
      if (event.startsAt && new Date(event.startsAt).getTime() < Date.now()) {
        return res.status(410).json({ error: 'This event has already started' });
      }

      // 1. Atomic seat reservation in Redis.
      let left = await seats.reserve(eventId, user.id);
      if (left === -3) {
        await ensureSeatsInitialised(event);
        left = await seats.reserve(eventId, user.id);
      }
      if (left === -2) {
        bookingsTotal.inc({ result: 'duplicate' });
        return res.status(409).json({ error: 'You already have a ticket for this event' });
      }
      if (left === -1) {
        bookingsTotal.inc({ result: 'sold_out' });
        return res.status(409).json({ error: 'Sold out', soldOut: true });
      }
      if (left < 0) throw new Error(`unexpected reserve result ${left}`);
      reserved = true;

      // 2. Durable record in PostgreSQL.
      bookingId = newId();
      await db.query(
        'INSERT INTO bookings (id, event_id, event_title, user_id) VALUES ($1, $2, $3, $4)',
        [bookingId, eventId, String(event.title).slice(0, 160), user.id],
      );

      // 3. Ask ticket-service for a signed QR ticket.
      const ticket = await tickets.issue(
        { bookingId, eventId, eventTitle: event.title, startsAt: event.startsAt, venue: event.venue, userId: user.id, holderName: user.name },
        req.id,
      );
      await db.query('UPDATE bookings SET ticket_id = $1 WHERE id = $2', [ticket.id, bookingId]);

      bookingsTotal.inc({ result: 'confirmed' });
      return res.status(201).json({
        booking: { id: bookingId, eventId, eventTitle: event.title, ticketId: ticket.id },
        ticket,
        seatsLeft: left,
      });
    } catch (err) {
      // Compensating actions (a small saga): undo the steps that already succeeded.
      if (bookingId) {
        await db.query('DELETE FROM bookings WHERE id = $1', [bookingId]).catch(() => {});
      }
      if (reserved) {
        await seats.release(eventId, user.id).catch(() => {});
      }
      bookingsTotal.inc({ result: 'error' });
      if (err.status || err.name === 'TimeoutError') {
        (req.log || console).warn({ err: err.message }, 'upstream failure during booking');
        return res.status(503).json({ error: 'Booking temporarily unavailable, please retry' });
      }
      return next(err);
    }
  });

  app.get('/bookings/me', async (req, res, next) => {
    const user = identity(req);
    if (!user) return res.status(401).json({ error: 'Login required' });
    try {
      const { rows } = await db.query(
        'SELECT id, event_id, event_title, ticket_id, created_at FROM bookings WHERE user_id = $1 ORDER BY created_at DESC',
        [user.id],
      );
      return res.json(
        rows.map((r) => ({ id: r.id, eventId: r.event_id, eventTitle: r.event_title, ticketId: r.ticket_id, createdAt: r.created_at })),
      );
    } catch (err) {
      return next(err);
    }
  });

  // Public: seats left for a list of events (null = no booking yet, so seats = capacity).
  app.get('/bookings/availability', async (req, res, next) => {
    try {
      const ids = String(req.query.eventIds || '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => EVENT_ID_RE.test(s))
        .slice(0, 100);
      return res.json(await seats.available(ids));
    } catch (err) {
      return next(err);
    }
  });

  // Organisers and volunteers can see live sales for an event.
  app.get('/bookings/events/:eventId/stats', async (req, res, next) => {
    const user = identity(req);
    if (!user || !['organiser', 'volunteer'].includes(user.role)) return res.status(403).json({ error: 'Organisers only' });
    if (!EVENT_ID_RE.test(req.params.eventId)) return res.status(400).json({ error: 'Invalid event id' });
    try {
      const live = await seats.stats(req.params.eventId);
      const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM bookings WHERE event_id = $1', [req.params.eventId]);
      return res.json({ eventId: req.params.eventId, bookings: rows[0].n, ...(live || {}) });
    } catch (err) {
      return next(err);
    }
  });

  app.get('/health', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      await seats.available([]);
      res.json({ status: 'ok', service: 'booking-service' });
    } catch {
      res.status(503).json({ status: 'down', service: 'booking-service' });
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

module.exports = { createApp, migrate };
