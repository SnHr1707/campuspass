'use strict';

// HTTP clients for the other services. Services find each other by their
// Kubernetes Service name (e.g. http://event-service:8081), set via environment variables.

class UpstreamError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function call(url, options = {}, timeoutMs = 3000) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new UpstreamError(`${url} responded ${res.status}`, res.status);
  return body;
}

// Event details change rarely, so each pod caches them for a short time.
// This keeps event-service out of the hot path during a registration rush.
function createEventClient(baseUrl, ttlMs = 30000) {
  const cache = new Map();
  return {
    async get(eventId, requestId) {
      const hit = cache.get(eventId);
      if (hit && hit.expires > Date.now()) return hit.event;
      try {
        const event = await call(`${baseUrl}/events/${eventId}`, { headers: { 'X-Request-Id': requestId || '' } });
        cache.set(eventId, { event, expires: Date.now() + ttlMs });
        return event;
      } catch (err) {
        if (err.status === 404) return null;
        throw err;
      }
    },
  };
}

function createTicketClient(baseUrl) {
  return {
    issue(payload, requestId) {
      return call(`${baseUrl}/internal/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId || '' },
        body: JSON.stringify(payload),
      });
    },
  };
}

module.exports = { createEventClient, createTicketClient, UpstreamError };
