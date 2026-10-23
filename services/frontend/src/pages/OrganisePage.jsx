import { useCallback, useEffect, useState } from 'react';
import { api, formatWhen } from '../api';
import { useSession } from '../session';

function defaultStart() {
  const d = new Date(Date.now() + 3 * 86400000);
  d.setMinutes(0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

const EMPTY = { title: '', description: '', venue: '', category: 'tech', startsAt: defaultStart(), capacity: 100 };

export default function OrganisePage() {
  const { token, user } = useSession();
  const [form, setForm] = useState(EMPTY);
  const [mine, setMine] = useState([]);
  const [stats, setStats] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const loadMine = useCallback(async () => {
    const all = await api('/events', { token });
    setMine(all.filter((e) => e.organiserId === user.id));
  }, [token, user.id]);

  useEffect(() => {
    loadMine().catch(() => {});
  }, [loadMine]);

  // Live sales for the organiser's events, refreshed every 3 seconds.
  useEffect(() => {
    if (!mine.length) return undefined;
    const tick = async () => {
      const entries = await Promise.all(
        mine.map((e) => api(`/bookings/events/${e.id}/stats`, { token }).then((s) => [e.id, s]).catch(() => [e.id, null])),
      );
      setStats(Object.fromEntries(entries));
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, [mine, token]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const body = { ...form, capacity: Number(form.capacity), startsAt: new Date(form.startsAt).toISOString() };
      const created = await api('/events', { method: 'POST', body, token });
      setMessage({ ok: true, text: `Published "${created.title}". Students can book it now.` });
      setForm({ ...EMPTY, startsAt: defaultStart() });
      setMine((m) => [...m, created]);
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="intro">
        <h1>Organise an event</h1>
        <p>Publish an event with a seat limit, then watch bookings arrive live.</p>
      </section>

      <div className="organise">
        <form className="panel form" onSubmit={submit}>
          <label>
            Event name
            <input value={form.title} onChange={update('title')} required maxLength={120} />
          </label>
          <label>
            Description
            <textarea value={form.description} onChange={update('description')} rows={3} maxLength={2000} />
          </label>
          <label>
            Venue
            <input value={form.venue} onChange={update('venue')} required maxLength={120} />
          </label>
          <div className="row">
            <label>
              Category
              <select value={form.category} onChange={update('category')}>
                <option value="tech">Tech</option>
                <option value="cultural">Cultural</option>
                <option value="workshop">Workshop</option>
                <option value="sports">Sports</option>
                <option value="talk">Talk</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Seats
              <input type="number" min={1} max={5000} value={form.capacity} onChange={update('capacity')} required />
            </label>
          </div>
          <label>
            Starts at
            <input type="datetime-local" value={form.startsAt} onChange={update('startsAt')} required />
          </label>
          {message && <p className={`notice ${message.ok ? 'ok' : 'err'}`}>{message.text}</p>}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Publishing…' : 'Publish event'}
          </button>
        </form>

        <section className="panel">
          <h2 className="panel-title">Your events</h2>
          {mine.length === 0 && <p className="muted">Events you publish appear here with live sales.</p>}
          <ul className="sales">
            {mine.map((e) => {
              const s = stats[e.id];
              const sold = s?.sold ?? s?.bookings ?? 0;
              const pct = Math.min(100, Math.round((sold / e.capacity) * 100));
              return (
                <li key={e.id}>
                  <div className="sales-head">
                    <strong>{e.title}</strong>
                    <span>{formatWhen(e.startsAt).full}</span>
                  </div>
                  <div className="bar" role="img" aria-label={`${sold} of ${e.capacity} seats sold`}>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  <p className="sales-numbers">
                    {sold} of {e.capacity} sold
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}
