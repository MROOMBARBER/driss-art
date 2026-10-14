import { useEffect, useState, type FormEvent } from 'react';
import { createSignal, dispatchSignalPush, finalizeSignal, watchSignals } from '../lib/signals';
import type { XauSignal, SignalStatus } from '../lib/types';
import { EmptyState, formatDate, LoadingState, Notice, SectionHeading } from './PortalUI';

const label: Record<SignalStatus, string> = { open: 'En cours', closed: 'Clôturé', tp_hit: 'TP atteint', sl_hit: 'SL atteint' };

export default function SignalsAdmin() {
  const [signals, setSignals] = useState<XauSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [entry, setEntry] = useState('');
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pushNotices, setPushNotices] = useState<Record<string, string>>({});

  useEffect(() => watchSignals(items => { setSignals(items); setLoading(false); setListError(''); },
    () => { setLoading(false); setListError('Impossible de lire les signaux.'); }), []);

  async function sendPush(eventId: string) {
    try {
      const result = await dispatchSignalPush(eventId);
      const report = result.alreadySent ? 'Notification déjà envoyée.' :
        result.sent === 0 && result.failed === 0 ? 'Aucun téléphone VIP actif inscrit aux notifications.' :
        `Notification envoyée à ${result.sent} appareil(s); ${result.failed} échec(s).`;
      setPushNotices(v => ({ ...v, [eventId]: report }));
    } catch {
      setPushNotices(v => ({ ...v, [eventId]: 'Enregistré, mais Push non confirmé : utilisez « Réessayer push ».' }));
    }
  }
  async function publish(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await createSignal({ side, entry, tp, sl, message });
      setEntry(''); setTp(''); setSl(''); setMessage('');
      setNotice('Signal XAUUSD publié et visible instantanément dans les espaces VIP.');
      await sendPush(result.eventId);
      setNotice(v => v + ' Résultat push indiqué sur le signal.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Enregistrement impossible.'); }
    finally { setBusy(false); }
  }
  async function end(signal: XauSignal, status: 'closed' | 'tp_hit' | 'sl_hit') {
    if (busyId || signal.status !== 'open') return;
    if (!window.confirm(`Confirmer « ${label[status]} » pour XAUUSD ${signal.side.toUpperCase()} ?`)) return;
    setBusyId(signal.id); setError(''); setNotice('');
    try {
      const result = await finalizeSignal(signal.id, status, notes[signal.id] || '');
      setNotice(`Signal XAUUSD ${signal.side.toUpperCase()} — ${label[status]} (mise à jour en temps réel).`);
      await sendPush(result.eventId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Clôture impossible.'); }
    finally { setBusyId(''); }
  }
  async function retry(signal: XauSignal) {
    if (!signal.lastEventId || busyId) return;
    setBusyId(signal.id);
    try { await sendPush(signal.lastEventId); } finally { setBusyId(''); }
  }

  return <section className="portal-card signals-panel">
    <SectionHeading eyebrow="XAUUSD • LIVE" title="Signaux BUY / SELL" />
    <p className="section-description">Envoyez un signal en temps réel. Entrée, TP, SL et message sont facultatifs. Les mises à jour déclenchent une notification push aux téléphones VIP abonnés.</p>
    <form className="portal-form signal-compose" onSubmit={publish}>
      <div className="signal-direction">
        <button type="button" aria-pressed={side === 'buy'} className={`signal-direction-button buy ${side === 'buy' ? 'selected' : ''}`} disabled={busy} onClick={() => setSide('buy')}>↗ BUY</button>
        <button type="button" aria-pressed={side === 'sell'} className={`signal-direction-button sell ${side === 'sell' ? 'selected' : ''}`} disabled={busy} onClick={() => setSide('sell')}>↘ SELL</button>
      </div>
      <div className="signal-fields">
        <label>Entrée (facultatif)<input value={entry} onChange={e => setEntry(e.target.value)} maxLength={100} disabled={busy} placeholder="Market / 2660" /></label>
        <label>TP (facultatif)<input value={tp} onChange={e => setTp(e.target.value)} maxLength={100} disabled={busy} placeholder="2670" /></label>
        <label>SL (facultatif)<input value={sl} onChange={e => setSl(e.target.value)} maxLength={100} disabled={busy} placeholder="2650" /></label>
      </div>
      <label>Message (facultatif)<textarea value={message} onChange={e => setMessage(e.target.value)} maxLength={1000} disabled={busy} rows={4} placeholder="Analyse ou consigne libre…" /></label>
      <button type="submit" disabled={busy} className="portal-button button-gold">{busy ? 'Publication…' : 'Publier le signal + notification 🔔'}</button>
    </form>
    {error && <Notice>{error}</Notice>}
    {notice && <Notice kind="success">{notice}</Notice>}
    <h3>Historique des signaux</h3>
    {loading ? <LoadingState /> : listError ? <Notice>{listError}</Notice> :
      signals.length === 0 ? <EmptyState title="Aucun signal">Publiez votre premier signal BUY ou SELL.</EmptyState> :
      <div className="signal-list">{signals.map(s => <article key={s.id} className={`signal-card ${s.side}`}>
        <div className="signal-heading"><strong>XAUUSD <span>{s.side.toUpperCase()}</span></strong><span className={`signal-status ${s.status}`}>{label[s.status]}</span></div>
        <div className="signal-values">{s.entry && <span><b>Entrée</b>{s.entry}</span>}{s.tp && <span><b>TP</b>{s.tp}</span>}{s.sl && <span><b>SL</b>{s.sl}</span>}</div>
        {s.message && <p className="signal-message">{s.message}</p>}
        <small>Publié : {formatDate(s.createdAt)}</small>
        {s.status !== 'open' && <p className="signal-close"><b>{label[s.status]}</b> • {formatDate(s.closedAt)}{s.closeNote && <span> — {s.closeNote}</span>}</p>}
        {s.status === 'open' && <div className="signal-finalize"><label>Message de clôture (facultatif)<input value={notes[s.id] || ''} maxLength={500} disabled={!!busyId} onChange={e => setNotes(n => ({ ...n, [s.id]: e.target.value }))} placeholder="Ex. +30 pips / clôture manuelle" /></label>
          <div className="signal-actions">
            <button type="button" disabled={!!busyId} onClick={() => end(s, 'closed')}>Clôturer</button>
            <button type="button" disabled={!!busyId} onClick={() => end(s, 'tp_hit')}>✓ TP atteint</button>
            <button type="button" disabled={!!busyId} onClick={() => end(s, 'sl_hit')}>SL atteint</button>
          </div>
        </div>}
        <div className="signal-push"><button type="button" className="text-button" disabled={!!busyId} onClick={() => retry(s)}>🔔 Réessayer push</button>
          {pushNotices[s.lastEventId] && <small role="status">{pushNotices[s.lastEventId]}</small>}</div>
      </article>)}</div>}
    <small className="broker-disclosure">Clôturé, TP atteint et SL atteint sont déclarés manuellement par l’admin. Aucun suivi automatique du prix ni exécution d’ordre. Risque de perte en trading.</small>
  </section>;
}
