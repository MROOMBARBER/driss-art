import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { disablePush, enablePush, listenForPush, pushConfigured, pushEnabled, supportsPush } from '../lib/push';

function deviceInstructions(): string {
  const ua = navigator.userAgent || '';
  const appleMobile = /iPhone|iPad|iPod/.test(ua);
  const standalone = window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true);
  if (appleMobile && !standalone) {
    return 'Sur iPhone/iPad : ouvrez ce site dans Safari, appuyez sur Partager, puis « Sur l’écran d’accueil ». Lancez ensuite XAUUSD depuis son icône pour activer les notifications.';
  }
  return 'Sur Android ou ordinateur : autorisez les notifications dans votre navigateur et désactivez le mode silencieux / Ne pas déranger pour recevoir les alertes.';
}

function pushFailureMessage(cause: unknown): string {
  const code = typeof cause === 'object' && cause && 'code' in cause ? String(cause.code) : '';
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    return 'Notifications bloquées. Dans les réglages du navigateur, autorisez les notifications de ce site, puis réessayez.';
  }
  if (code.includes('permission')) return 'Autorisez les notifications pour ce site dans votre navigateur.';
  if (code.includes('token-subscribe') || code.includes('invalid-vapid') || code.includes('bad-vapid')) {
    return 'La clé Web Push du projet Firebase doit être configurée. Contactez l’administrateur.';
  }
  if (code.includes('unsupported') || code.includes('sw-registration') || code.includes('service-worker')) {
    return 'Votre navigateur ne permet pas encore ce service. Essayez Chrome ou installez XAUUSD sur l’écran d’accueil.';
  }
  if (code.includes('permission-denied')) return 'L’accès Firebase à votre appareil a été refusé. Réessayez après votre activation.';
  if (cause instanceof Error && /^Les notifications|^L’activation/.test(cause.message)) return cause.message;
  return 'Impossible d’activer les notifications. Vérifiez les autorisations du site puis réessayez.';
}

export default function PushNotifications({ user }: { user: User }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let disposed = false;
    let unsubscribe = () => {};
    setEnabled(false);
    setError('');
    setNotice('');
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
          const body = payload.notification?.body || payload.data?.body || 'Une nouvelle annonce est disponible.';
          setNotice('Nouvelle notification : ' + title);
          void navigator.serviceWorker.ready.then(registration => registration.showNotification(title, {
            body,
            icon: '/icon.svg',
            tag: payload.data?.announcementId,
            data: { path: '/dashboard' },
          })).catch(() => {});
        });
        if (disposed) stop(); else unsubscribe = stop;
      }
    })().catch(() => { if (!disposed) setError('Les notifications ne sont pas disponibles pour le moment.'); });
    return () => { disposed = true; unsubscribe(); };
  }, [user.uid]);

  async function toggle() {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (enabled) {
        await disablePush(user);
        setEnabled(false);
      } else {
        await enablePush(user);
        setEnabled(true);
        setNotice('Appareil enregistré. Les futures alertes de votre abonnement pourront arriver ici.');
      }
    } catch (cause) {
      setError(pushFailureMessage(cause));
    } finally { setBusy(false); }
  }

  async function testOnDevice() {
    setError(''); setNotice('');
    try {
      if (!enabled || Notification.permission !== 'granted') throw new Error('Les notifications ne sont pas activées sur cet appareil.');
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification('XAUUSD — notification de test', {
        body: 'Votre appareil affiche bien les notifications locales. Pour tester un vrai envoi, publiez une annonce depuis Admin.',
        icon: '/icon.svg',
        tag: 'xauusd-device-test',
        data: { path: '/dashboard' },
      });
      setNotice('Test local envoyé sur cet appareil. Le test réel du serveur se fait depuis Admin > Annonces.');
    } catch (cause) {
      setError(pushFailureMessage(cause));
    }
  }

  return <div className="push-controls">
    <div className="push-device-status" aria-live="polite">
      <span aria-hidden="true">🔔</span>
      <strong>{enabled ? 'Notifications activées' : 'Notifications sur cet appareil'}</strong>
    </div>
    <button type="button" className={`portal-button ${enabled ? 'button-outline' : 'button-gold'}`} onClick={toggle}
      disabled={busy || supported !== true || !pushConfigured}>
      {busy ? 'Un instant…' : enabled ? 'Désactiver les notifications' : 'Activer les notifications push'}
    </button>
    {enabled && <button type="button" className="portal-button button-outline" onClick={testOnDevice} disabled={busy}>
      Tester la notification sur mon appareil
    </button>}
    <p className="space-empty" aria-live="polite">{supported === null ? 'Vérification de votre appareil…'
      : !supported ? deviceInstructions()
      : !pushConfigured ? 'La configuration de Firebase Messaging est incomplète. Contactez l’administrateur.'
      : enabled ? 'Cet appareil est inscrit aux alertes de votre espace.'
      : 'Cliquez pour demander l’autorisation à votre navigateur.'}</p>
    <details className="push-help"><summary>Comment recevoir les notifications sur mon téléphone ?</summary>
      <p>{deviceInstructions()}</p>
      <p>Vous devez activer les alertes sur chaque appareil. Les notifications réelles sont envoyées depuis la section Admin &gt; Annonces.</p>
    </details>
    {notice && <p className="portal-notice notice-success" role="status">{notice}</p>}
    {error && <p className="portal-notice notice-error" role="alert">{error}</p>}
  </div>;
}
