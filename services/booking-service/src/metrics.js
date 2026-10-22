'use strict';

const client = require('prom-client');

const register = new client.Registry();
register.setDefaultLabels({ service: 'booking-service' });
client.collectDefaultMetrics({ register });

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

const bookingsTotal = new client.Counter({
  name: 'campuspass_bookings_total',
  help: 'Booking attempts by result',
  labelNames: ['result'],
  registers: [register],
});

function metricsMiddleware(req, res, next) {
  if (req.path === '/metrics' || req.path === '/health') return next();
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    const route = req.route ? req.route.path : 'unmatched';
    end({ method: req.method, route, status: String(res.statusCode) });
  });
  return next();
}

// Seats-left gauge is read from Redis at scrape time, so Grafana always shows the live count.
function registerSeatGauge(seatStore) {
  return new client.Gauge({
    name: 'campuspass_seats_left',
    help: 'Seats left per event',
    labelNames: ['event_id'],
    registers: [register],
    async collect() {
      this.reset();
      try {
        const counts = await seatStore.allSeatCounts();
        for (const [eventId, left] of Object.entries(counts)) {
          if (left !== null) this.set({ event_id: eventId }, left);
        }
      } catch {
        // Redis unavailable: report nothing rather than failing the whole scrape.
      }
    },
  });
}

module.exports = { register, metricsMiddleware, bookingsTotal, registerSeatGauge };
