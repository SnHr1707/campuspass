import { afterEach, describe, expect, test, vi } from 'vitest';
import { api, ApiError, formatWhen } from './api';

afterEach(() => vi.unstubAllGlobals());

function mockFetch(status, body) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: status < 400, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) })),
  );
}

describe('api()', () => {
  test('sends JSON and the bearer token to /api', async () => {
    mockFetch(201, { id: 1 });
    const res = await api('/bookings', { method: 'POST', body: { eventId: 'x' }, token: 'abc' });
    expect(res).toEqual({ id: 1 });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('/api/bookings');
    expect(opts.headers.Authorization).toBe('Bearer abc');
    expect(JSON.parse(opts.body)).toEqual({ eventId: 'x' });
  });

  test('turns error responses into ApiError with the server message', async () => {
    mockFetch(409, { error: 'Sold out' });
    await expect(api('/bookings', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 409, message: 'Sold out' });
  });

  test('explains network failures in plain words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const err = await api('/events').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toMatch(/Cannot reach CampusPass/);
  });
});

test('formatWhen splits a date into display parts', () => {
  const parts = formatWhen('2026-11-01T12:30:00Z');
  expect(parts.month).toBeTruthy();
  expect(Number(parts.day)).toBeGreaterThan(0);
});
