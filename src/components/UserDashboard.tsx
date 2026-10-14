import { useEffect, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { updateDisplayName, watchAnnouncements, watchApplication, watchEntitlement, watchMemberAudit, watchProfile } from '../lib/membership';
import type { Announcement, ApplicationSettings, AuditEntry, Entitlement, UserProfile } from '../lib/types';
import { ArrowIcon, EmptyState, formatDate, friendlyError, LoadingState, Notice, SectionHeading, SpaceIcon, StatusBadge, supportUrl, statusLabels } from './PortalUI';
import PushNotifications from './PushNotifications';
import SignalsFeed from './SignalsFeed';
import { DEFAULT_BROKER_URL } from '../lib/broker';

export default function UserDashboard({ user }: { user: User }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const [accessError, setAccessError] = useState('');
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState('');
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [application, setApplication] = useState<ApplicationSettings | null>(null);
  const [applicationLoading, setApplicationLoading] = useState(false);
  const [applicationError, setApplicationError] = useState('');
  const [editName, setEditName] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setProfile(null); setEntitlement(null); setAnnouncements([]); setHistory([]);
    setProfileLoading(true); setAccessLoading(true); setNewsLoading(true); setHistoryLoading(true);
    setProfileError(''); setAccessError(''); setNewsError(''); setHistoryError('');
    const stops = [
      watchProfile(user.uid, value => { setProfile(value); setProfileLoading(false); setProfileError(''); }, error => { setProfileLoading(false); setProfileError(friendlyError(error)); }),
      watchEntitlement(user.uid, value => { setEntitlement(value); setAccessLoading(false); setAccessError(''); }, error => { setAccessLoading(false); setAccessError(friendlyError(error)); }),
      watchAnnouncements(value => { setAnnouncements(value); setNewsLoading(false); setNewsError(''); }, error => { setNewsLoading(false); setNewsError(friendlyError(error)); }),
      watchMemberAudit(user.uid, value => { setHistory(value); setHistoryLoading(false); setHistoryError(''); }, error => { setHistoryLoading(false); setHistoryError(friendlyError(error)); }),
    ];
    return () => { stops.forEach(stop => stop()); };
  }, [user.uid]);

  useEffect(() => {
    setApplication(null); setApplicationError(''); setApplicationLoading(false);
    if (entitlement?.status !== 'active') return;
    setApplicationLoading(true);
    return watchApplication(value => { setApplication(value); setApplicationLoading(false); setApplicationError(''); }, error => { setApplicationLoading(false); setApplicationError(friendlyError(error)); });
  }, [user.uid, entitlement?.status]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (editName.trim().length < 2) { setSaveError('Votre nom doit contenir au moins 2 caractères.'); return; }
    setSaving(true); setSaveError(''); setSaved(false);
    try { await updateDisplayName(user.uid, editName.trim()); setEditing(false); setSaved(true); }
    catch (error) { setSaveError(friendlyError(error)); }
    finally { setSaving(false); }
  }

  const status = entitlement?.status ?? 'pending';
  const displayName = profile?.displayName || user.displayName || 'Membre';
  const activationLink = supportUrl(`Bonjour, je souhaite activer mon accès à l’application XAUUSD à 2 000 DH à vie. Mon compte : ${user.email || user.uid}.`);
  const validDownload = application?.downloadUrl && /^https:\/\//i.test(application.downloadUrl) ? application.downloadUrl : '';
  // Saved administrator settings override the owner-provided Exness partner link.
  const validBroker = application?.brokerUrl && /^https:\/\//i.test(application.brokerUrl) ? application.brokerUrl : DEFAULT_BROKER_URL;
  const isExnessBroker = (() => {
    try { return /(^|\.)exnessonelink\.com$/i.test(new URL(validBroker).hostname); }
    catch { return false; }
  })();
  const hasAccess = !accessLoading && !accessError && status === 'active';

  return <div className="dashboard-page">
    <div className="dashboard-intro"><div><span className="portal-eyebrow">VOTRE ESPACE PERSONNEL</span><h1>Bonjour, <em>{displayName.split(' ')[0]}.</em></h1><p>Votre application et les dernières nouvelles, à portée de main.</p></div><span className="live-label"><span aria-hidden="true" />Mis à jour en temps réel</span></div>
    {hasAccess && <nav className="member-quick-actions" aria-label="Accès rapides">
      <a className="portal-button button-outline" href="#signaux-xauusd">↗ Signaux XAUUSD LIVE</a>
      <a className="portal-button button-outline" href="#videos-explicatives"><SpaceIcon kind="video" /> Voir les vidéos explicatives</a>
      <a className="portal-button button-outline" href="#notifications-push"><SpaceIcon kind="notification" /> Notifications push</a>
    </nav>}
    {hasAccess && <SignalsFeed />}
    {hasAccess && <section className="member-spaces" aria-label="Vos trois espaces XAUUSD">
      <article id="videos-explicatives" className="portal-card member-space video-space"><div className="space-topline"><span className="space-number">01</span><span className="space-icon" aria-hidden="true"><SpaceIcon kind="video" /></span></div><h2>Comprendre.<br /><em>Depuis zéro.</em></h2><p>Vos vidéos explicatives pour découvrir les bases et avancer étape par étape.</p>{applicationLoading ? <LoadingState label="Chargement des vidéos…" /> : applicationError ? <Notice>{applicationError}</Notice> : application?.videos?.length ? <ol className="member-video-list">{application.videos.filter(video => /^https:\/\//i.test(video.url)).map((video, index) => <li key={video.id}><a href={video.url} target="_blank" rel="noopener noreferrer"><span className="video-number">{String(index + 1).padStart(2, '0')}</span><span>{video.title}</span><ArrowIcon /></a></li>)}</ol> : <div className="space-empty">Vos premières vidéos seront disponibles ici dès leur publication.</div>}</article>
      <article className="portal-card member-space broker-space"><div className="space-topline"><span className="space-number">02</span><span className="space-icon" aria-hidden="true"><SpaceIcon kind="broker" /></span></div>{isExnessBroker && <div className="broker-wordmark"><img src="/exness-logo.svg" alt="Exness — broker partenaire" width="280" height="58" loading="lazy" /></div>}<h2>Votre broker.<br /><em>Un lien direct.</em></h2><p>Retrouvez le lien de notre broker partenaire pour ouvrir votre compte.</p>{applicationLoading ? <LoadingState label="Chargement du lien…" /> : applicationError ? <Notice>{applicationError}</Notice> : <a className="portal-button button-gold" href={validBroker} target="_blank" rel="noopener noreferrer sponsored">{isExnessBroker ? 'Ouvrir un compte Exness' : 'Accéder au broker'}<ArrowIcon /></a>}<small className="broker-disclosure">Lien d’affiliation : nous pouvons recevoir une commission. Le trading comporte un risque de perte en capital.</small></article>
      <article id="notifications-push" className="portal-card member-space notification-space"><div className="space-topline"><span className="space-number">03</span><span className="space-icon" aria-hidden="true"><SpaceIcon kind="notification" /></span></div><h2>Restez au courant.<br /><em>Activez les alertes.</em></h2><p>Recevez les notifications de votre espace sur cet appareil.</p><PushNotifications user={user} /></article>
    </section>}
    <div className="user-dashboard-grid">
      <section className={`portal-card access-card access-${status}`} aria-labelledby="access-title">
        <div className="access-topline"><span className="card-kicker">VOTRE ABONNEMENT</span>{!accessLoading && !accessError && <StatusBadge status={status} />}</div>
        <div className="access-product"><span className="product-mark" aria-hidden="true">Au<span>79</span></span><div><h2 id="access-title">Application XAUUSD</h2><p>Le pack à vie</p></div></div>
        <div className="access-price">2 000 <span>DH</span><small>Un paiement · Un accès à vie</small></div>
        <div className="access-divider" />
        {accessLoading ? <LoadingState label="Vérification de votre accès…" /> : accessError ? <Notice>{accessError}</Notice> : <>
          <p className="access-copy">{status === 'active' ? 'Votre accès à vie est activé. Retrouvez vos vidéos, votre broker et vos notifications dans les trois espaces ci-dessus.' : status === 'suspended' ? 'Votre accès est suspendu. Notre équipe peut vous aider à comprendre et à résoudre la situation.' : 'Votre compte est prêt. Contactez notre équipe pour les instructions de paiement et l’activation de votre accès après paiement de 2 000 DH.'}</p>
          {status === 'active' ? <div className="application-access">{validDownload && <a className="portal-button button-outline" href={validDownload} target="_blank" rel="noopener noreferrer">Lien de l’application<ArrowIcon /></a>}<span className="access-active-note">Vos trois espaces sont disponibles ci-dessus.</span></div> : <a className="portal-button button-gold" href={status === 'pending' ? activationLink : supportUrl(`Bonjour, mon accès XAUUSD est suspendu. Pouvez-vous m’aider ? Compte : ${user.email || user.uid}.`)} target="_blank" rel="noopener noreferrer">{status === 'pending' ? 'Payer et demander l’activation' : 'Contacter le support'}<ArrowIcon /></a>}
          {entitlement && <span className="access-updated">Dernière mise à jour : {formatDate(entitlement.updatedAt)}</span>}
        </>}
      </section>
      <section className="portal-card profile-card" aria-labelledby="profile-title">
        <SectionHeading eyebrow="MON COMPTE" title="Votre profil" id="profile-title" />
        {profileLoading ? <LoadingState /> : profileError ? <Notice>{profileError}</Notice> : <>
          <div className="profile-avatar" aria-hidden="true">{displayName.slice(0, 2).toUpperCase()}</div>
          {editing ? <form className="portal-form" onSubmit={saveProfile}><label htmlFor="profile-name">Nom complet<input id="profile-name" autoComplete="name" value={editName} onChange={event => setEditName(event.target.value)} minLength={2} maxLength={80} required disabled={saving} autoFocus /></label>{saveError && <Notice>{saveError}</Notice>}<div className="button-row"><button type="submit" className="portal-button button-gold button-small" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button><button type="button" className="portal-button button-ghost button-small" onClick={() => { setEditing(false); setSaveError(''); }} disabled={saving}>Annuler</button></div></form> : <><h3>{displayName}</h3><p className="profile-email">{profile?.email || user.email}</p><button type="button" className="portal-button button-outline button-small" onClick={() => { setEditName(displayName); setEditing(true); setSaved(false); }}>Modifier mon nom</button>{saved && <Notice kind="success">Votre nom a été mis à jour.</Notice>}</>}
          {profile?.createdAt && <span className="profile-since">Membre depuis le {formatDate(profile.createdAt)}</span>}
        </>}
      </section>
      <section className="portal-card announcements-card" aria-labelledby="news-title"><SectionHeading eyebrow="LES DERNIÈRES NOUVELLES" title="Annonces" id="news-title" /><p className="section-description">Les informations publiées par notre équipe.</p>{newsLoading ? <LoadingState /> : newsError ? <Notice>{newsError}</Notice> : announcements.length === 0 ? <EmptyState title="Vous êtes à jour">Les prochaines annonces apparaîtront ici.</EmptyState> : <div className="announcement-list">{announcements.map(item => <article key={item.id} className="announcement-item"><time>{formatDate(item.createdAt)}</time><h3>{item.title}</h3><p>{item.body}</p></article>)}</div>}</section>
      <section className="portal-card history-card" aria-labelledby="history-title"><SectionHeading eyebrow="LE SUIVI DE VOTRE ACCÈS" title="Historique" id="history-title" />{historyLoading ? <LoadingState /> : historyError ? <Notice>{historyError}</Notice> : history.length === 0 ? <EmptyState title="Votre histoire commence ici">Les changements de statut de votre accès seront affichés dans cet espace.</EmptyState> : <ol className="history-list">{history.map(item => <li key={item.id}><span className={`history-point history-${item.status}`} aria-hidden="true" /><div><strong>{statusLabels[item.status]}</strong><span>{formatDate(item.createdAt)}</span></div><StatusBadge status={item.status} /></li>)}</ol>}</section>
    </div>
    <aside className="support-banner"><div><span className="portal-eyebrow">UNE QUESTION ?</span><h2>Nous sommes là pour vous.</h2><p>Pour l’activation de votre accès ou un accompagnement, écrivez-nous.</p></div><a className="portal-button button-outline" href={supportUrl('Bonjour, j’ai une question concernant mon espace XAUUSD.')} target="_blank" rel="noopener noreferrer">Discuter sur WhatsApp<ArrowIcon /></a></aside>
  </div>;
}
