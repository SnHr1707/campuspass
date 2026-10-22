'use strict';

const crypto = require('node:crypto');
const { Pool } = require('pg');
const Redis = require('ioredis');
const pino = require('pino');
const pinoHttp = require('pino-http');
const { createApp, migrate } = require('./app');
const { createSeatStore } = require('./seats');
const { createEventClient, createTicketClient } = require('./clients');
const { registerSeatGauge } = require('./metrics');

const log = pino({ level: process.env.LOG_LEVEL || 'info', base: { service: 'booking-service' } });
const port = Number(process.env.PORT || 3002);

const db = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_SIZE || 20) });
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 2 });
redis.on('error', (err) => log.warn({ err: err.message }, 'redis error'));

async function connectWithRetry(attempts = 30) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await migrate(db);
      await redis.ping();
      return;
    } catch (err) {
      log.warn({ attempt: i, err: err.message }, 'dependencies not ready, retrying in 2s');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('Could not connect to PostgreSQL/Redis');
}

async function main() {
  await connectWithRetry();
  const seats = createSeatStore(redis);
  registerSeatGauge(seats);
  const app = createApp({
    db,
    seats,
    events: createEventClient(process.env.EVENT_SERVICE_URL || 'http://localhost:8081'),
    tickets: createTicketClient(process.env.TICKET_SERVICE_URL || 'http://localhost:8000'),
    newId: () => crypto.randomUUID(),
    logger: pinoHttp({
      logger: log,
      genReqId: (req) => req.headers['x-request-id'] || crypto.randomUUID(),
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/metrics' },
    }),
  });
  const server = app.listen(port, () => log.info({ port }, 'booking-service listening'));

  const shutdown = () => {
    log.info('shutting down');
    server.close(() => Promise.allSettled([db.end(), redis.quit()]).then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  log.fatal({ err }, 'failed to start');
  process.exit(1);
});
