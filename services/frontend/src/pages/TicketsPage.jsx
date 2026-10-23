import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { api, formatWhen } from '../api';
import { useSession } from '../session';

function QrImage({ value }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 1, width: 320, color: { dark: '#1E1B3A', light: '#FFFFFF' } }).then(setSrc);
  }, [value]);
  return src ? <img className="qr" src={src} alt="QR code for this ticket" width="220" height="220" /> : <div className="qr" />;
}

export default function TicketsPage() {
  const { token, user } = useSession();
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/tickets/me', { token })
      .then(setTickets)
      .catch((err) => setError(err.message));
  }, [token]);

  return (
    <>
      <section className="intro">
        <h1>Your tickets</h1>
        <p>Show the QR code at the entry gate. Each ticket can be scanned once.</p>
      </section>
      {error && <p className="notice err">{error}</p>}
      {!tickets && !error && <p className="notice">Loading tickets…</p>}
      {tickets?.length === 0 && (
        <p className="notice">
          You have no tickets yet. <Link to="/">Browse events</Link> and book a seat.
        </p>
      )}
      <div className="tickets">
        {tickets?.map((t) => {
          const when = t.startsAt ? formatWhen(t.startsAt) : null;
          return (
            <article key={t.id} className={`ticket${t.usedAt ? ' is-used' : ''}`}>
              <div className="ticket-info">
                <h2>{t.eventTitle}</h2>
                {when && <p className="ticket-when">{when.full}</p>}
                {t.venue && <p className="ticket-venue">{t.venue}</p>}
                <p className="ticket-holder">Admits {t.holderName || user.name}</p>
                {t.usedAt && <p className="ticket-used">Checked in at {formatWhen(t.usedAt).time}</p>}
              </div>
              <div className="ticket-qr">
                <QrImage value={t.token} />
                <code className="ticket-code" title="Ticket code">{t.id.slice(0, 8)}</code>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
