import { useEffect, useState } from 'react';
import { watchSignals } from '../lib/signals';
import type { XauSignal, SignalStatus } from '../lib/types';
import { EmptyState, formatDate, LoadingState, Notice, SectionHeading } from './PortalUI';
const labels: Record<SignalStatus, string> = { open: 'En cours', closed: 'Clôturé', tp_hit: 'TP atteint', sl_hit: 'SL atteint' };
export default function SignalsFeed() {
  const [items, setItems] = useState<XauSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => watchSignals(data => { setItems(data); setLoading(false); setError(''); },
    () => { setLoading(false); setError('Impossible de charger les signaux.'); }), []);
  return <section id="signaux-xauusd" className="portal-card signals-panel signals-feed">
    <SectionHeading eyebrow="XAUUSD • TEMPS RÉEL" title="Signaux VIP" />
    <p className="section-description">Chaque signal et clôture apparaît ici en direct. Activez les notifications push sur votre appareil pour recevoir une alerte.</p>
    {loading ? <LoadingState /> : error ? <Notice>{error}</Notice> : items.length === 0 ?
      <EmptyState title="En attente du premier signal">Les prochains signaux XAUUSD apparaîtront ici.</EmptyState> :
      <div className="signal-list">{items.map(s => <article key={s.id} className={`signal-card ${s.side}`}>
        <div className="signal-heading"><strong>XAUUSD <span>{s.side.toUpperCase()}</span></strong><span className={`signal-status ${s.status}`}>{labels[s.status]}</span></div>
        <div className="signal-values">{s.entry && <span><b>Entrée</b>{s.entry}</span>}{s.tp && <span><b>TP</b>{s.tp}</span>}{s.sl && <span><b>SL</b>{s.sl}</span>}</div>
        {s.message && <p className="signal-message">{s.message}</p>}
        <small>Publié : {formatDate(s.createdAt)}</small>
        {s.status !== 'open' && <p className="signal-close"><b>{labels[s.status]}</b> • {formatDate(s.closedAt)}{s.closeNote && <span> — {s.closeNote}</span>}</p>}
      </article>)}</div>}
    <small className="broker-disclosure">Statuts mis à jour manuellement par l’administrateur; aucun suivi automatique du marché. Trading : risque de perte.</small>
  </section>;
}
