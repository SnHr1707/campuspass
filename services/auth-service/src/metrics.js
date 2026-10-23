'use strict';

const client = require('prom-client');

const register = new client.Registry();
register.setDefaultLabels({ service: 'auth-service' });
client.collectDefaultMetrics({ register });

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

function metricsMiddleware(req, res, next) {
  if (req.path === '/metrics' || req.path === '/health') return next();
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    // Use the matched route pattern, not the raw URL, to keep label cardinality low.
    const route = req.route ? req.route.path : 'unmatched';
    end({ method: req.method, route, status: String(res.statusCode) });
  });
  return next();
}

module.exports = { register, metricsMiddleware };
