import { useEffect, useState, type FormEvent } from 'react';
import { getIdTokenResult, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { ArrowIcon, friendlyError, Notice } from './PortalUI';

/**
 * Separate UI for administrators. Authorization is NOT derived from this form:
 * Firebase custom claim admin:true plus Firestore rules enforce access.
 */
export default function AdminLogin({ alreadyAdmin }: { alreadyAdmin: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (alreadyAdmin) window.location.replace('/admin');
  }, [alreadyAdmin]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || busy || alreadyAdmin) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      if (resetMode) {
        await sendPasswordResetEmail(auth, email.trim());
        setSuccess('Si le compte existe, un e-mail de réinitialisation sera envoyé. Vérifiez également vos courriers indésirables.');
        return;
      }

      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const token = await getIdTokenResult(credential.user, true);
      if (token.claims.admin !== true) {
        // The browser never chooses the authorized UID. The server verifies the
        // signed Firebase token against Vercel's private ADMIN_BOOTSTRAP_UID.
        const response = await fetch('/api/admin/bootstrap', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token.token },
          cache: 'no-store',
        });
        const data = await response.json().catch(() => ({})) as { error?: string; activated?: boolean };
        if (!response.ok || data.activated !== true) {
          const issues: Record<string, string> = {
            setup_not_configured: "L'activation initiale doit être configurée dans Vercel : ADMIN_BOOTSTRAP_UID.",
            firebase_server_unavailable: "Vérifiez les identifiants serveur Firebase dans Vercel.",
            incorrect_firebase_project: "Le serveur doit être connecté au projet Firebase vipxauusd-f0693.",
            not_bootstrap_owner: "Ce compte n'est pas l'administrateur autorisé.",
            invalid_authentication: "Session expirée. Réessayez de vous connecter.",
            user_disabled: "Votre compte est désactivé dans Firebase.",
            admin_role_update_failed: "Firebase n'a pas pu attribuer le rôle administrateur. Vérifiez les permissions du compte de service.",
          };
          throw new Error(issues[data.error || ''] || "L'activation administrateur n'est pas encore disponible.");
        }
        const updatedToken = await getIdTokenResult(credential.user, true);
        if (updatedToken.claims.admin !== true) {
          throw new Error("Le rôle a été créé, mais la session ne s'est pas actualisée. Réessayez.");
        }
      }
      window.location.replace('/admin');
    } catch (cause) {
      if (auth?.currentUser) await signOut(auth).catch(() => {});
      setError(cause instanceof Error && !('code' in cause)
        ? cause.message
        : friendlyError(cause, 'Connexion administrateur impossible. Vérifiez vos informations et réessayez.'));
    } finally {
      setBusy(false);
    }
  }

  return <div className="admin-login-layout">
    <div className="admin-login-intro">
      <span className="portal-eyebrow"><span className="gold-dot" /> CONSOLE D'ADMINISTRATION</span>
      <div className="admin-login-icon" aria-hidden="true"><svg viewBox="0 0 64 64" width="54" height="54" fill="none"><path d="M32 5 52 14v15c0 14-8 23-20 30C20 52 12 43 12 29V14L32 5Z" stroke="currentColor" strokeWidth="2"/><path d="M23 32 30 39 43 25" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
      <h1>Pilotez votre<br /><em>espace XAUUSD.</em></h1>
      <p>Gérez les membres, validez les accès, publiez vos formations et communiquez avec votre communauté depuis une interface sécurisée.</p>
      <div className="admin-login-features"><span>01 <strong>Gestion des accès</strong></span><span>02 <strong>Vidéos et broker</strong></span><span>03 <strong>Notifications</strong></span></div>
    </div>

    <section className="portal-card auth-card admin-login-card" aria-labelledby="admin-login-title">
      <span className="card-kicker">ACCÈS ADMINISTRATEUR UNIQUEMENT</span>
      <h2 id="admin-login-title">{resetMode ? 'Mot de passe oublié ?' : 'Bienvenue, Admin.'}</h2>
      <p className="card-description">{resetMode ? 'Indiquez votre e-mail administrateur pour recevoir le lien de réinitialisation.' : 'Connectez-vous avec votre compte administrateur Firebase. Les comptes membres ne peuvent pas accéder à cette interface.'}</p>
      {error && <Notice>{error}</Notice>}
      {success && <Notice kind="success">{success}</Notice>}
      {alreadyAdmin
        ? <a href="/admin" className="portal-button button-gold auth-submit">Ouvrir mon Dashboard <ArrowIcon /></a>
        : <form className="portal-form" onSubmit={submit}>
          <label htmlFor="admin-email">E-mail administrateur
            <input id="admin-email" type="email" autoComplete="username" inputMode="email" placeholder="admin@exemple.com" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} required />
          </label>
          {!resetMode && <label htmlFor="admin-password">Mot de passe
            <span className="password-field">
              <input id="admin-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" maxLength={128} placeholder="Votre mot de passe sécurisé" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} required />
              <button type="button" className="password-toggle" aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} aria-pressed={showPassword} onClick={() => setShowPassword(current => !current)}>{showPassword ? 'Masquer' : 'Voir'}</button>
            </span>
          </label>}
          {!resetMode && <button type="button" className="text-button forgot-button" disabled={busy} onClick={() => { setResetMode(true); setError(''); setSuccess(''); setPassword(''); }}>Mot de passe oublié ?</button>}
          <button type="submit" disabled={busy || !auth} className="portal-button button-gold auth-submit">{busy ? 'Vérification…' : resetMode ? 'Envoyer le lien' : 'Se connecter à l’administration'}{!busy && <ArrowIcon />}</button>
          {resetMode && <button type="button" className="text-button" disabled={busy} onClick={() => { setResetMode(false); setError(''); setSuccess(''); }}>Revenir à la connexion</button>}
        </form>}
      <p className="admin-login-return"><a href="/">← Retour au site</a></p>
    </section>
  </div>;
}
