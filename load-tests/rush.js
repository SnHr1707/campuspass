// k6 load test: the registration rush.
//
// An organiser opens an event with SEATS seats, then STUDENTS students all press
// "Book" within the same second. Expected result: exactly SEATS bookings succeed,
// everyone else gets "Sold out", and nothing returns a server error.
//
// Run:  k6 run -e BASE_URL=https://campuspass.duckdns.org load-tests/rush.js
//       (or let scripts/rush.ps1 run it as a Job inside the cluster)
// Env:  BASE_URL, STUDENTS (default 500), SEATS (default 100), ORGANISER_INVITE_CODE

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import exec from 'k6/execution';

const BASE = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const STUDENTS = Number(__ENV.STUDENTS || 500);
const SEATS = Number(__ENV.SEATS || 100);
const ORG_CODE = __ENV.ORGANISER_INVITE_CODE || 'ORG-2026';
const RUN = `${Date.now()}`;

const confirmed = new Counter('bookings_confirmed');
const soldOut = new Counter('bookings_sold_out');
const failed = new Counter('bookings_failed');

export const options = {
  setupTimeout: '10m',
  scenarios: {
    rush: {
      executor: 'per-vu-iterations',
      vus: STUDENTS,
      iterations: 1,
      maxDuration: '3m',
    },
  },
  thresholds: {
    // The point of the demo: no student ever sees a server error, even under the rush.
    bookings_failed: ['count==0'],
    bookings_confirmed: [`count==${SEATS}`],
    'http_req_duration{name:book}': ['p(95)<2000'],
  },
};

const auth = (token) => ({ headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });

function registerMany(count) {
  const tokens = [];
  const batchSize = 20; // stays inside the gateway's sign-up rate limit
  for (let start = 0; start < count; start += batchSize) {
    const batch = [];
    for (let i = start; i < Math.min(start + batchSize, count); i += 1) {
      batch.push([
        'POST',
        `${BASE}/api/auth/register`,
        JSON.stringify({ name: `Rush Student ${i}`, email: `rush-${RUN}-${i}@load.test`, password: 'load-test-pass' }),
        { headers: { 'Content-Type': 'application/json' } },
      ]);
    }
    for (const res of http.batch(batch)) {
      if (res.status !== 201) throw new Error(`registration failed: ${res.status} ${res.body}`);
      tokens.push(res.json('token'));
    }
    sleep(1);
  }
  return tokens;
}

export function setup() {
  const org = http.post(
    `${BASE}/api/auth/register`,
    JSON.stringify({ name: 'Rush Organiser', email: `rush-org-${RUN}@load.test`, password: 'load-test-pass', inviteCode: ORG_CODE }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (org.status !== 201) throw new Error(`organiser sign-up failed: ${org.status} ${org.body}`);
  const orgToken = org.json('token');

  const startsAt = new Date(Date.now() + 2 * 86400000).toISOString();
  const event = http.post(
    `${BASE}/api/events`,
    JSON.stringify({ title: `Rush Test ${RUN}`, description: 'k6 load test', venue: 'Load Lab', category: 'tech', startsAt, capacity: SEATS }),
    auth(orgToken),
  );
  if (event.status !== 201) throw new Error(`event creation failed: ${event.status} ${event.body}`);

  console.log(`Registering ${STUDENTS} students...`);
  const tokens = registerMany(STUDENTS);
  console.log(`Event ${event.json('id')} has ${SEATS} seats. Releasing ${STUDENTS} students at once.`);
  return { eventId: event.json('id'), orgToken, tokens };
}

export default function (data) {
  const token = data.tokens[exec.vu.idInTest - 1];
  const res = http.post(`${BASE}/api/bookings`, JSON.stringify({ eventId: data.eventId }), {
    ...auth(token),
    tags: { name: 'book' },
  });
  if (res.status === 201) confirmed.add(1);
  else if (res.status === 409) soldOut.add(1);
  else failed.add(1);
  check(res, { 'booked or sold out (never an error)': (r) => r.status === 201 || r.status === 409 });
}

export function teardown(data) {
  const stats = http.get(`${BASE}/api/bookings/events/${data.eventId}/stats`, auth(data.orgToken));
  console.log(`Final count from booking-service: ${stats.body}`);
  const sold = stats.json('sold');
  if (sold !== SEATS) throw new Error(`OVERSOLD OR UNDERSOLD: ${sold} of ${SEATS}`);
}
