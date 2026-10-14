import { getApp } from 'firebase/app';
import { type User } from 'firebase/auth';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { deleteToken, getMessaging, getToken, isSupported, onMessage, type MessagePayload } from 'firebase/messaging';
import { auth, db, firebaseConfigured } from './firebase';

// Firebase Messaging can use the project's default Web Push key if a
// dedicated VAPID public key has not been configured yet. A custom key
// remains recommended for consistent browser/device support.
const vapidKey = String(import.meta.env.VITE_FIREBASE_VAPID_KEY || '').trim();
export const pushConfigured = firebaseConfigured
  && Boolean(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID);
export const customVapidConfigured = vapidKey.length > 0;

const storageKey = (uid: string) => `xauusd-push-${uid}`;
const storedHash = (uid: string) => {
  try { return localStorage.getItem(storageKey(uid)); } catch { return null; }
};
const saveHash = (uid: string, hash: string | null) => {
  try { if (hash) localStorage.setItem(storageKey(uid), hash); else localStorage.removeItem(storageKey(uid)); } catch { /* Firestore remains authoritative. */ }
};

export async function supportsPush() {
  return typeof Notification !== 'undefined' && window.isSecureContext && await isSupported();
}

export async function pushEnabled(uid: string) {
  if (!db || typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  const hash = storedHash(uid);
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return false;
  return (await getDoc(doc(db, 'pushTokens', uid, 'tokens', hash))).exists();
}

export async function enablePush(user: User) {
  if (!db || !pushConfigured || !await supportsPush()) {
    throw new Error('Les notifications ne sont pas encore disponibles sur cet appareil.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Les notifications sont désactivées dans votre navigateur.');
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(getApp()), {
    ...(vapidKey ? { vapidKey } : {}),
    serviceWorkerRegistration: registration,
  });
  if (!token) throw new Error('L’activation a échoué. Réessayez dans quelques instants.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  const reference = doc(db, 'pushTokens', user.uid, 'tokens', hash);
  const existing = await getDoc(reference);
  await setDoc(reference, {
    token,
    createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  saveHash(user.uid, hash);
}

export async function disablePush(user: User) {
  if (!db) return;
  const hash = storedHash(user.uid);
  if (hash && /^[a-f0-9]{64}$/.test(hash)) await deleteDoc(doc(db, 'pushTokens', user.uid, 'tokens', hash));
  if (pushConfigured && await supportsPush()) await deleteToken(getMessaging(getApp()));
  saveHash(user.uid, null);
}

export async function listenForPush(callback: (payload: MessagePayload) => void) {
  if (!pushConfigured || !await supportsPush()) return () => {};
  return onMessage(getMessaging(getApp()), callback);
}

export interface PushDeliveryResult { sent: number; failed: number; alreadySent: boolean; status: string }

export async function dispatchAnnouncementPush(announcementId: string): Promise<PushDeliveryResult> {
  if (!auth?.currentUser) throw new Error('Connectez-vous pour envoyer une notification.');
  const token = await auth.currentUser.getIdToken();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 55000);
  try {
    const response = await fetch('/api/admin/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ announcementId }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('L’annonce est publiée. L’envoi push n’est pas disponible pour le moment.');
    return await response.json() as PushDeliveryResult;
  } finally { window.clearTimeout(timeout); }
}
