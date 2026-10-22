import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatWhen } from '../api';
import { useSession } from '../session';

const CATEGORIES = [
  ['', 'All'],
  ['tech', 'Tech'],
  ['cultural', 'Cultural'],
  ['workshop', 'Workshops'],
  ['sports', 'Sports'],
  ['talk', 'Talks'],
];

// Seat counts refresh every few seconds, so students watch the number fall during a rush.
const POLL_MS = 3000;

function SeatCounter({ left, capacity }) {
  const prev = useRef(left);
  const [ticked, setTicked] = useState(false);
  useEffect(() => {
    if (prev.current !== left) {
      setTicked(true);
      const t = setTimeout(() => setTicked(false), 600);
      prev.current = left;
      return () => clearTimeout(t);
    }
    return undefined;
  }, [left]);

  const soldOut = left === 0;
  const low = !soldOut && left <= Math.max(5, capacity * 0.1);
  return (
    <div className={`counter${soldOut ? ' is-sold-out' : ''}${low ? ' is-low' : ''}`} aria-live="polite">
      <span className={`counter-number${ticked ? ' ticked' : ''}`}>{soldOut ? '0' : left}</span>
      <span className="counter-label">{soldOut ? 'sold out' : `of ${capacity} seats left`}</span>
    </div>
  );
}

function EventStub({ event, left, onBook, state }) {
  const when = formatWhen(event.startsAt);
  const seatsLeft = left ?? event.capacity;
  const soldOut = seatsLeft === 0;
  return (
    <article className="stub">
      <div className="stub-date" aria-label={when.full}>
        <span className="stub-day">{when.day}</span>
        <span className="stub-month">{when.month}</span>
        <span className="stub-weekday">{when.weekday}</span>
      </div>
      <div className="stub-body">
        <span className={`tag tag-${event.category}`}>{event.category}</span>
        <h2 className="stub-title">{event.title}</h2>
        <p className="stub-meta">
          {event.venue}, {when.time}
        </p>
        {event.description && <p className="stub-desc">{event.description}</p>}
        {state?.message && (
          <p className={`stub-status ${state.ok ? 'ok' : 'err'}`} role="status">
            {state.message} {state.ok && <Link to="/tickets">See your ticket</Link>}
          </p>
        )}
      </div>
      <div className="stub-tear">
        <SeatCounter left={seatsLeft} capacity={event.capacity} />
        <button
          type="button"
          className="btn btn-primary"
          disabled={soldOut || state?.busy || state?.ok}
          onClick={() => onBook(event)}
        >
          {state?.ok ? 'Booked' : state?.busy ? 'Booking…' : soldOut ? 'Sold out' : 'Book a seat'}
        </button>
      </div>
    </article>
  );
}

export default function EventsPage() {
  const { token } = useSession();
  const navigate = useNavigate();
  const [category, setCategory] = useState('');
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const [seats, setSeats] = useState({});
  const [bookingState, setBookingState] = useState({});

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    api(`/events${category ? `?category=${category}` : ''}`)
      .then((data) => !cancelled && (setEvents(data), setError('')))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [category]);

  const refreshSeats = useCallback(async () => {
    if (!events?.length) return;
    try {
      const ids = events.map((e) => e.id).join(',');
      setSeats(await api(`/bookings/availability?eventIds=${ids}`));
    } catch {
      // Keep showing the last known counts.
    }
  }, [events]);

  useEffect(() => {
    refreshSeats();
    const id = setInterval(refreshSeats, POLL_MS);
    return () => clearInterval(id);
  }, [refreshSeats]);

  async function book(event) {
    if (!token) {
      navigate('/login', { state: { from: '/' } });
      return;
    }
    setBookingState((s) => ({ ...s, [event.id]: { busy: true } }));
    try {
      const res = await api('/bookings', { method: 'POST', body: { eventId: event.id }, token });
      setSeats((s) => ({ ...s, [event.id]: res.seatsLeft }));
      setBookingState((s) => ({ ...s, [event.id]: { ok: true, message: 'Seat booked.' } }));
    } catch (err) {
      setBookingState((s) => ({ ...s, [event.id]: { ok: false, message: err.message } }));
      refreshSeats();
    }
  }

  return (
    <>
      <section className="intro">
        <h1>Popular events fill up in minutes. Book yours here.</h1>
        <p>Seat counts update live. Every booking gets a QR ticket you show at the gate.</p>
      </section>

      <div className="filters" role="group" aria-label="Filter by category">
        {CATEGORIES.map(([value, label]) => (
          <button
            key={value || 'all'}
            type="button"
            className={`chip${category === value ? ' is-active' : ''}`}
            aria-pressed={category === value}
            onClick={() => setCategory(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="notice err">{error}</p>}
      {!events && !error && <p className="notice">Loading events…</p>}
      {events && events.length === 0 && (
        <p className="notice">No upcoming events in this category yet. Check back soon, or try another category.</p>
      )}

      <div className="stubs">
        {events?.map((event) => (
          <EventStub key={event.id} event={event} left={seats[event.id]} onBook={book} state={bookingState[event.id]} />
        ))}
      </div>
    </>
  );
}
