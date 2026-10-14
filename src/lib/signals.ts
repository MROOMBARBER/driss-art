import { collection, limit, onSnapshot, orderBy, query, type FirestoreError, type Unsubscribe } from 'firebase/firestore';
import { auth, db } from './firebase';
import type { XauSignal } from './types';

export function watchSignals(next: (items: XauSignal[]) => void, onError: (error: FirestoreError) => void): Unsubscribe {
  if (!db) throw new Error('Firebase est indisponible.');
  return onSnapshot(query(collection(db, 'signals'), orderBy('createdAt', 'desc'), limit(50)),
    snapshot => next(snapshot.docs.map(d => ({ ...d.data(), id: d.id } as XauSignal))), onError);
}
async function request(method: 'POST' | 'PATCH', body: Record<string, unknown>) {
  const user = auth?.currentUser;
  if (!user) throw new Error('Connexion administrateur nécessaire.');
  const token = await user.getIdToken();
  const response = await fetch('/api/admin/signals', {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store',
  });
  const json = await response.json().catch(() => ({})) as { signalId?: string; eventId?: string; error?: string };
  if (!response.ok || !json.signalId || !json.eventId) {
    if (json.error === 'already_finalized') throw new Error('Ce signal est déjà clôturé. Actualisez la liste.');
    if (json.error === 'administrator_required') throw new Error('Accès administrateur nécessaire.');
    throw new Error('Impossible d’enregistrer le signal. Réessayez.');
  }
  return { signalId: json.signalId, eventId: json.eventId };
}
export function createSignal(fields: { side: 'buy' | 'sell'; entry: string; tp: string; sl: string; message: string }) {
  return request('POST', fields);
}
export function finalizeSignal(signalId: string, status: 'closed' | 'tp_hit' | 'sl_hit', closeNote = '') {
  return request('PATCH', { signalId, status, closeNote });
}
export async function dispatchSignalPush(eventId: string) {
  const user = auth?.currentUser;
  if (!user) throw new Error('Connexion administrateur nécessaire.');
  const token = await user.getIdToken();
  const response = await fetch('/api/admin/signal-push', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId }), cache: 'no-store',
  });
  const result = await response.json().catch(() => ({})) as {
    sent?: number; failed?: number; alreadySent?: boolean; status?: string; error?: string;
  };
  if (!response.ok && response.status !== 202) throw new Error('Événement enregistré, mais notification non envoyée. Réessayez l’envoi.');
  return { sent: result.sent ?? 0, failed: result.failed ?? 0, alreadySent: Boolean(result.alreadySent),
    status: result.status ?? 'unknown' };
}
