import { useState, type FormEvent } from 'react';
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { ensureProfile } from '../lib/membership';
import { ArrowIcon, friendlyError, Notice, supportUrl } from './PortalUI';

type Mode = 'login' | 'register' | 'reset';

export default function AuthForm() {
  const [mode, setMode] = useState<Mode>(() => new URLSearchParams(window.location.search).get('mode') === 'register' ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  function changeMode(next: Mode) {
    if (busy) return;
    setMode(next);
    setError('');
    setSuccess('');
    setPassword('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || busy) return;
    setError('');
    setSuccess('');
    if (mode === 'register' && name.trim().length < 2) { setError('Saisissez votre nom, avec au moins 2 caractères.'); return; }
    if (mode === 'register' && password.length < 8) { setError('Votre mot de passe doit contenir au moins 8 caractères.'); return; }
    setBusy(true);
    try {
      if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email.trim());
        setSuccess('Si un compte correspond à cette adresse, vous recevrez un e-mail pour réinitialiser votre mot de passe. Pensez à vérifier vos courriers indésirables.');
      } else {
        const credential = mode === 'register'
          ? await createUserWithEmailAndPassword(auth, email.trim(), password)
          : await signInWithEmailAndPassword(auth, email.trim(), password);
        if (mode === 'register') await updateProfile(credential.user, { displayName: name.trim() });
        await ensureProfile(credential.user, mode === 'register' ? name.trim() : undefined);
        window.location.assign('/dashboard');
      }
    } catch (cause) {
      setError(friendlyError(cause, 'Connexion impossible pour le moment. Réessayez ou contactez le support.'));
    } finally { setBusy(false); }
  }

  return <div className="auth-layout">
    <section className="auth-intro" aria-label="Votre espace XAUUSD">
      <span className="portal-eyebrow"><span className="gold-dot" /> L’espace des membres</span>
      <h1>Votre accès.<br />Votre espace.<br /><em>Tout, au même endroit.</em></h1>
      <p>Retrouvez votre application XAUUSD, les annonces et le suivi de votre accès dans un espace personnel.</p>
      <div className="auth-offer"><span className="offer-symbol" aria-hidden="true">Au</span><div><span>Application XAUUSD</span><strong>2 000 DH <small>/ à vie</small></strong></div></div>
      <ul className="auth-benefits"><li><span aria-hidden="true">✓</span> Un seul paiement pour votre accès à vie</li><li><span aria-hidden="true">✓</span> Suivi du statut de votre accès en temps réel</li><li><span aria-hidden="true">✓</span> Une assistance directement sur WhatsApp</li></ul>
      <div className="auth-footnote">Le trading comporte un risque de perte en capital. Aucun rendement n’est garanti.</div>
    </section>
    <section className="portal-card auth-card" aria-labelledby="auth-title">
      <span className="card-kicker">BIENVENUE CHEZ XAUUSD</span>
      <h2 id="auth-title">{mode === 'reset' ? 'Un nouveau départ.' : mode === 'register' ? 'Créez votre espace.' : 'Heureux de vous revoir.'}</h2>
      <p className="card-description">{mode === 'reset' ? 'Recevez un lien de réinitialisation par e-mail.' : mode === 'register' ? 'Votre compte vous permet de demander et de suivre l’activation de votre accès.' : 'Connectez-vous pour retrouver votre tableau de bord.'}</p>
      {mode !== 'reset' && <div className="auth-tabs" aria-label="Mode de connexion"><button type="button" aria-pressed={mode === 'login'} onClick={() => changeMode('login')} disabled={busy}>Connexion</button><button type="button" aria-pressed={mode === 'register'} onClick={() => changeMode('register')} disabled={busy}>Créer un compte</button></div>}
      <form onSubmit={submit} className="portal-form">
        {mode === 'register' && <label htmlFor="auth-name">Votre nom<input id="auth-name" autoComplete="name" value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={80} placeholder="Prénom et nom" disabled={busy} required /></label>}
        <label htmlFor="auth-email">Adresse e-mail<input id="auth-email" type="email" autoComplete="email" inputMode="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="vous@exemple.com" maxLength={254} disabled={busy} required /></label>
        {mode !== 'reset' && <label htmlFor="auth-password">Mot de passe<span className="password-field"><input id="auth-password" aria-label="Mot de passe" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} minLength={mode === 'register' ? 8 : undefined} maxLength={128} placeholder={mode === 'register' ? '8 caractères minimum' : 'Votre mot de passe'} disabled={busy} required /><button type="button" className="password-toggle" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} aria-pressed={showPassword}>{showPassword ? 'Masquer' : 'Voir'}</button></span></label>}
        {mode === 'login' && <button className="text-button forgot-button" type="button" onClick={() => changeMode('reset')} disabled={busy}>Mot de passe oublié ?</button>}
        {error && <Notice>{error}</Notice>}
        {success && <Notice kind="success">{success}</Notice>}
        <button className="portal-button button-gold auth-submit" type="submit" disabled={busy || !auth}>{busy ? 'Un instant…' : mode === 'reset' ? 'Envoyer le lien' : mode === 'register' ? 'Créer mon compte' : 'Accéder à mon espace'}{!busy && <ArrowIcon />}</button>
        {mode === 'reset' && <button className="text-button" type="button" onClick={() => changeMode('login')} disabled={busy}>Revenir à la connexion</button>}
      </form>
      <p className="auth-support">Besoin d’aide ? <a href={supportUrl('Bonjour, j’ai besoin d’aide pour accéder à mon espace XAUUSD.')} target="_blank" rel="noopener noreferrer">Contactez-nous</a></p>
    </section>
  </div>;
}
