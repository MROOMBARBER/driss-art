import { useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import { auth, firebaseConfigured } from './lib/firebase';
import { useSession } from './useSession';
import AuthForm from './components/AuthForm';
import AdminLogin from './components/AdminLogin';
import UserDashboard from './components/UserDashboard';
import AdminDashboard from './components/AdminDashboard';
import { Notice, LoadingState } from './components/PortalUI';

export default function App() {
  const session = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const route = window.location.pathname;
  const authPage = route === '/connexion' || route === '/portal.html';
  const adminLoginPage = route === '/admin/connexion';
  const isLoginPage = authPage || adminLoginPage;

  useEffect(() => {
    if (firebaseConfigured && !session.loading && !session.user && !isLoginPage) {
      window.location.replace(route === '/admin' ? '/admin/connexion' : '/connexion');
    }
  }, [session.loading, session.user, isLoginPage, route]);

  useEffect(() => {
    document.title = `${route === '/admin' || adminLoginPage ? 'Administration' : authPage ? 'Connexion' : 'Mon espace'} — XAUUSD`;
  }, [route, authPage, adminLoginPage]);

  async function logout() {
    if (!auth || signingOut) return;
    setSigningOut(true); setLogoutError('');
    try { await signOut(auth); window.location.assign('/connexion'); }
    catch { setLogoutError('La déconnexion a échoué. Réessayez.'); setSigningOut(false); }
  }

  return <div className="portal-shell">
    <a className="portal-skip" href="#portal-main">Aller au contenu</a>
    <header className="portal-header">
      <a className="portal-brand" href="/" aria-label="XAUUSD — Accueil"><span className="portal-brand-mark" aria-hidden="true"><i /><i /><i /></span><span>XAUUSD<small>APPLICATION</small></span></a>
      <nav className="portal-nav" aria-label="Navigation de l’espace membre">
        <a href="/">Accueil</a>
        {session.user && <a href="/dashboard" aria-current={route === '/dashboard' ? 'page' : undefined}>Mon espace</a>}
        {session.isAdmin && <a href="/admin" aria-current={route === '/admin' ? 'page' : undefined}>Administration</a>}
        {session.user && <button type="button" onClick={logout} disabled={signingOut}>{signingOut ? 'Déconnexion…' : 'Se déconnecter'}</button>}
      </nav>
    </header>
    <main id="portal-main" className="portal-main">
      {logoutError && <Notice>{logoutError}</Notice>}
      {!firebaseConfigured ? <section className="portal-card portal-unavailable"><span className="portal-eyebrow">ESPACE MEMBRE</span><h1>Votre nouvel espace<br /><em>arrive bientôt.</em></h1><p>L’espace membre est en préparation. Notre équipe reste disponible pour vous renseigner sur l’accès à XAUUSD.</p><a className="portal-button button-gold" href="https://wa.me/212751019600" target="_blank" rel="noopener noreferrer">Contacter l’équipe</a></section>
        : adminLoginPage ? <><AdminLogin alreadyAdmin={!session.loading && session.isAdmin} />{session.error && <Notice>{session.error}</Notice>}</>
        : authPage ? <><AuthForm />{session.error && <Notice>{session.error}</Notice>}{session.user && !session.loading && <p className="session-notice">Vous êtes déjà connecté. <a href="/dashboard">Retrouver mon espace</a></p>}</>
        : session.loading ? <LoadingState label="Ouverture de votre espace…" />
        : session.error ? <Notice>{session.error}</Notice>
        : !session.user ? <LoadingState label="Redirection vers la connexion…" />
        : route === '/admin' ? session.isAdmin ? <AdminDashboard user={session.user} /> : <section className="portal-card portal-unavailable"><h1>Accès réservé.</h1><p>Cette page est réservée à l’administration. Connectez-vous avec un compte autorisé.</p><a className="portal-button button-gold" href="/admin/connexion">Connexion administrateur</a></section>
        : <UserDashboard user={session.user} />}
    </main>
    <footer className="portal-footer"><span>© {new Date().getFullYear()} XAUUSD</span><span>Un paiement. Un accès à vie.</span><a href="https://wa.me/212751019600" target="_blank" rel="noopener noreferrer">Une question ? Contactez-nous.</a></footer>
  </div>;
}
