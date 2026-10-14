import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { disablePush, enablePush, listenForPush, pushConfigured, pushEnabled, supportsPush } from '../lib/push';

export default function PushNotifications({ user }: { user: User }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    let unsubscribe = () => {};
    setEnabled(false); setError('');
    void (async () => {
      const available = await supportsPush().catch(() => false);
      if (disposed) return;
      setSupported(available);
      if (available && pushConfigured) {
        const active = await pushEnabled(user.uid).catch(() => false);
        if (!disposed) setEnabled(active);
        const stop = await listenForPush(payload => {
          if (Notification.permission !== 'granted') return;
          const title = payload.notification?.title || payload.data?.title || 'XAUUSD';
          const body = payload.notification?.body || payload.data?.body || 'Une nouvelle annonce est disponible dans votre espace.';
          void navigator.serviceWorker.ready.then(registration => registration.showNotification(title, {
            body,
            icon: '/icon.svg',
            tag: payload.data?.announcementId,
            data: { path: '/dashboard' },
          })).catch(() => { /* A browser may revoke notifications while the page is open. */ });
        });
        if (disposed) stop(); else unsubscribe = stop;
      }
    })().catch(() => { if (!disposed) setError('Les notifications ne sont pas disponibles pour le moment.'); });
    return () => { disposed = true; unsubscribe(); };
  }, [user.uid]);

  async function toggle() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (enabled) await disablePush(user); else await enablePush(user);
      setEnabled(!enabled);
    } catch {
      setError(typeof Notification !== 'undefined' && Notification.permission === 'denied'
        ? 'Autorisez les notifications dans les réglages de ce site, puis réessayez.'
        : 'L’activation des notifications a échoué. Réessayez dans quelques instants.');
    } finally { setBusy(false); }
  }

  return <div className="push-controls">
    <button type="button" className={`portal-button ${enabled ? 'button-outline' : 'button-gold'}`} onClick={toggle} disabled={busy || supported !== true || !pushConfigured}>
      {busy ? 'Un instant…' : enabled ? 'Désactiver les notifications' : 'Activer les notifications'}
    </button>
    <p className="space-empty" aria-live="polite">{supported === null ? 'Vérification de votre appareil…'
      : !supported ? 'Sur iPhone ou iPad, ajoutez ce site à votre écran d’accueil. Sur ordinateur, utilisez un navigateur compatible avec les notifications.'
      : !pushConfigured ? 'Les notifications push seront disponibles ici dès leur mise en service.'
      : enabled ? 'Les notifications sont activées sur cet appareil.' : 'Vous choisissez d’autoriser les notifications dans votre navigateur.'}</p>
    {error && <p className="portal-notice notice-error" role="alert">{error}</p>}
  </div>;
}
