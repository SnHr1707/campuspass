import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { api } from '../api';
import { useSession } from '../session';

const RESULT_TEXT = {
  valid: 'Let them in',
  already_used: 'Already scanned',
  invalid: 'Not a valid ticket',
};

export default function GatePage() {
  const { token } = useSession();
  const [result, setResult] = useState(null);
  const [manual, setManual] = useState('');
  const [camera, setCamera] = useState('off'); // off | starting | on | error
  const scanner = useRef(null);
  const lastScan = useRef({ value: '', at: 0 });

  const check = useCallback(
    async (value) => {
      const now = Date.now();
      // The camera reports the same code many times a second; only check it once.
      if (value === lastScan.current.value && now - lastScan.current.at < 4000) return;
      lastScan.current = { value, at: now };
      try {
        const res = await api('/tickets/verify', { method: 'POST', body: { token: value }, token });
        setResult(res);
      } catch (err) {
        setResult(err.body?.status ? err.body : { status: 'invalid', message: err.message });
      }
    },
    [token],
  );

  async function startCamera() {
    setCamera('starting');
    try {
      scanner.current = new Html5Qrcode('qr-reader');
      await scanner.current.start({ facingMode: 'environment' }, { fps: 10, qrbox: 240 }, (text) => check(text), () => {});
      setCamera('on');
    } catch {
      setCamera('error');
    }
  }

  async function stopCamera() {
    try {
      await scanner.current?.stop();
    } catch {
      // already stopped
    }
    setCamera('off');
  }

  useEffect(
    () => () => {
      scanner.current?.stop().catch(() => {});
    },
    [],
  );

  return (
    <>
      <section className="intro">
        <h1>Gate check-in</h1>
        <p>Scan a student's QR ticket. A ticket works once; a second scan is flagged.</p>
      </section>

      {result && (
        <div className={`verdict verdict-${result.status}`} role="status" aria-live="assertive">
          <strong>{RESULT_TEXT[result.status] || result.status}</strong>
          <span>{result.message}</span>
          {result.ticket && <span className="verdict-event">{result.ticket.eventTitle}</span>}
        </div>
      )}

      <div className="gate">
        <div className="panel">
          <div id="qr-reader" className="reader" />
          {camera === 'error' && (
            <p className="notice err">Camera unavailable. Allow camera access in your browser, or paste the ticket code below.</p>
          )}
          {camera === 'on' ? (
            <button type="button" className="btn" onClick={stopCamera}>Stop camera</button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={startCamera} disabled={camera === 'starting'}>
              {camera === 'starting' ? 'Starting camera…' : 'Start camera'}
            </button>
          )}
        </div>

        <form
          className="panel form"
          onSubmit={(e) => {
            e.preventDefault();
            lastScan.current = { value: '', at: 0 };
            if (manual.trim()) check(manual.trim());
          }}
        >
          <label>
            Ticket code
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="CP1.…" autoComplete="off" />
          </label>
          <button type="submit" className="btn">Check ticket</button>
        </form>
      </div>
    </>
  );
}
