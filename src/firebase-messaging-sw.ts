import { initializeApp } from 'firebase/app';
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw';

const worker = self as unknown as ServiceWorkerGlobalScope;
const configuration = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

if (Object.values(configuration).every(value => Boolean(value))) {
  const messaging = getMessaging(initializeApp(configuration));
  // FCM displays notification payloads itself. Display only data-only payloads
  // here, so members never receive two notifications for one announcement.
  onBackgroundMessage(messaging, payload => {
    if (payload.notification) return;
    return worker.registration.showNotification(payload.data?.title || 'XAUUSD', {
      body: payload.data?.body || 'Une nouvelle annonce est disponible.',
      icon: '/icon.svg',
      tag: payload.data?.announcementId,
      data: { path: '/dashboard' },
    });
  });
}

worker.addEventListener('notificationclick', event => {
  // FCM handles its own notification payloads and links.
  if (event.notification.data?.FCM_MSG) return;
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === worker.location.origin);
    if (existing) { await existing.focus(); await existing.navigate('/dashboard'); }
    else await worker.clients.openWindow('/dashboard');
  })());
});
