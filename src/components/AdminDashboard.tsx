import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { deleteAnnouncement, saveAnnouncement, saveApplication, setMemberStatus, watchAnnouncements, watchApplication, watchAuditLogs, watchMembers } from '../lib/membership';
import type { Announcement, ApplicationSettings, AuditEntry, MemberRecord, MembershipStatus } from '../lib/types';
import { dispatchAnnouncementPush } from '../lib/push';
import { ArrowIcon, EmptyState, formatDate, friendlyError, LoadingState, Notice, SectionHeading, StatusBadge, statusLabels } from './PortalUI';

type Tab = 'members' | 'announcements' | 'application' | 'audit';
type VideoDraft = { id: string; title: string; url: string };
const pageSize = 10;

function checkedUrl(value: string, label: string, optional = false) {
  if (!value.trim() && optional) return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    return url.toString();
  } catch { throw new Error(`${label} doit être un lien HTTPS valide.`); }
}

export default function AdminDashboard({ user }: { user: User }) {
  const [tab, setTab] = useState<Tab>('members');
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<MembershipStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [rowBusy, setRowBusy] = useState<Record<string, MembershipStatus | undefined>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState('');
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');
  const [postSuccess, setPostSuccess] = useState('');
  const [lastPublishedId, setLastPublishedId] = useState('');
  const [pushBusy, setPushBusy] = useState<Record<string, boolean>>({});
  const [pushMessages, setPushMessages] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState('');
  const [application, setApplication] = useState<ApplicationSettings | null>(null);
  const [applicationLoading, setApplicationLoading] = useState(true);
  const [applicationError, setApplicationError] = useState('');
  const [appTitle, setAppTitle] = useState('Application XAUUSD');
  const [appDescription, setAppDescription] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [brokerUrl, setBrokerUrl] = useState('');
  const [videos, setVideos] = useState<VideoDraft[]>([]);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsSuccess, setSettingsSuccess] = useState('');

  useEffect(() => {
    const stops = [
      watchMembers(value => { setMembers(value); setMembersLoading(false); setMembersError(''); }, error => { setMembersLoading(false); setMembersError(friendlyError(error)); }),
      watchAnnouncements(value => { setAnnouncements(value); setNewsLoading(false); setNewsError(''); }, error => { setNewsLoading(false); setNewsError(friendlyError(error)); }),
      watchAuditLogs(value => { setAudit(value); setAuditLoading(false); setAuditError(''); }, error => { setAuditLoading(false); setAuditError(friendlyError(error)); }),
      watchApplication(value => { setApplication(value); setApplicationLoading(false); setApplicationError(''); }, error => { setApplicationLoading(false); setApplicationError(friendlyError(error)); }),
    ];
    return () => { stops.forEach(stop => stop()); };
  }, [user.uid]);

  useEffect(() => {
    if (settingsDirty) return;
    setAppTitle(application?.title || 'Application XAUUSD');
    setAppDescription(application?.description || '');
    setDownloadUrl(application?.downloadUrl || '');
    setBrokerUrl(application?.brokerUrl || '');
    setVideos(application?.videos || []);
  }, [application, settingsDirty]);

  const counts = useMemo(() => members.reduce((result, member) => {
    result[member.entitlement?.status ?? 'pending'] += 1;
    return result;
  }, { active: 0, pending: 0, suspended: 0 }), [members]);
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('fr');
    return members.filter(member => (filter === 'all' || (member.entitlement?.status ?? 'pending') === filter) && (!query || `${member.profile.displayName} ${member.profile.email} ${member.uid}`.toLocaleLowerCase('fr').includes(query)));
  }, [members, filter, search]);
  const lastPage = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, lastPage);
  const rows = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setPage(1); }, [filter, search]);
  const memberName = (uid: string) => members.find(member => member.uid === uid)?.profile.email || uid;

  async function changeStatus(member: MemberRecord, next: MembershipStatus) {
    if (rowBusy[member.uid]) return;
    setRowBusy(value => ({ ...value, [member.uid]: next }));
    setRowErrors(value => ({ ...value, [member.uid]: '' }));
    try { await setMemberStatus(member.uid, next); }
    catch (error) { setRowErrors(value => ({ ...value, [member.uid]: friendlyError(error, 'Le statut n’a pas pu être modifié. Réessayez. Le statut affiché reste la référence.') })); }
    finally { setRowBusy(value => ({ ...value, [member.uid]: undefined })); }
  }

  async function publishAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (posting) return;
    setPostError(''); setPostSuccess(''); setLastPublishedId('');
    if (announcementTitle.trim().length < 3 || announcementBody.trim().length < 10) { setPostError('Ajoutez un titre de 3 caractères minimum et un message de 10 caractères minimum.'); return; }
    setPosting(true);
    let publishedId = '';
    try { publishedId = await saveAnnouncement({ title: announcementTitle.trim(), body: announcementBody.trim() }); setAnnouncementTitle(''); setAnnouncementBody(''); setLastPublishedId(publishedId); setPostSuccess('Annonce publiée. Elle est visible dans les espaces membres.'); }
    catch (error) { setPostError(friendlyError(error, 'L’annonce n’a pas été publiée. Votre texte est conservé.')); }
    finally { setPosting(false); }
    if (publishedId) await sendNotification(publishedId);
  }

  async function sendNotification(id: string) {
    if (pushBusy[id]) return;
    setPushBusy(value => ({ ...value, [id]: true }));
    setPushMessages(value => ({ ...value, [id]: '' }));
    try {
      const result = await dispatchAnnouncementPush(id);
      let message = '';
      if (result.status === 'sending') message = 'L’envoi de cette notification est déjà en cours.';
      else if (result.status === 'failed') message = 'L’annonce reste publiée. L’envoi de la notification a échoué.';
      else if (result.alreadySent) message = 'L’envoi de cette annonce a déjà été traité. Aucun doublon n’a été envoyé.';
      else if (result.sent === 0 && result.failed === 0) message = 'L’annonce est publiée. Aucun appareil de membre actif n’est inscrit aux notifications pour le moment.';
      else message = `Notification envoyée à ${result.sent} appareil${result.sent > 1 ? 's' : ''}.${result.failed ? ` ${result.failed} appareil${result.failed > 1 ? 's' : ''} ${result.failed > 1 ? 'n’ont' : 'n’a'} pas pu être joint${result.failed > 1 ? 's' : ''}.` : ''}`;
      setPushMessages(value => ({ ...value, [id]: message }));
    } catch {
      setPushMessages(value => ({ ...value, [id]: 'L’annonce reste publiée. L’envoi push est indisponible pour le moment. Vous pouvez réessayer depuis la liste des annonces.' }));
    } finally { setPushBusy(value => ({ ...value, [id]: false })); }
  }

  async function removeAnnouncement(id: string) {
    if (deleting) return;
    setDeleting(id); setDeleteErrors(value => ({ ...value, [id]: '' }));
    try { await deleteAnnouncement(id); setDeleteConfirm(null); }
    catch (error) { setDeleteErrors(value => ({ ...value, [id]: friendlyError(error, 'L’annonce n’a pas pu être supprimée. Réessayez.') })); }
    finally { setDeleting(null); }
  }

  function changeVideo(id: string, key: 'title' | 'url', value: string) {
    setSettingsDirty(true); setSettingsSuccess('');
    setVideos(items => items.map(item => item.id === id ? { ...item, [key]: value } : item));
  }

  async function persistSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingSettings) return;
    setSettingsError(''); setSettingsSuccess('');
    let payload;
    try {
      if (!appDescription.trim()) throw new Error('Ajoutez une présentation de votre espace.');
      if (appTitle.trim().length < 3) throw new Error('Le titre doit contenir au moins 3 caractères.');
      const cleanedVideos = videos.map((video, index) => {
        if (video.title.trim().length < 3) throw new Error(`Ajoutez un titre de 3 caractères minimum à la vidéo ${index + 1}.`);
        return { id: video.id, title: video.title.trim(), url: checkedUrl(video.url, `Le lien de la vidéo ${index + 1}`) };
      });
      payload = { title: appTitle.trim(), description: appDescription.trim(), downloadUrl: checkedUrl(downloadUrl, 'Le lien de l’application', true), brokerUrl: checkedUrl(brokerUrl, 'Le lien du broker', true), videos: cleanedVideos };
    } catch (error) { setSettingsError(error instanceof Error ? error.message : 'Vérifiez les informations saisies.'); return; }
    setSavingSettings(true);
    try { await saveApplication(payload); setSettingsDirty(false); setSettingsSuccess('Les contenus ont été enregistrés. Les membres actifs voient la nouvelle version en temps réel.'); }
    catch (error) { setSettingsError(friendlyError(error, 'Les contenus n’ont pas été enregistrés. Vos modifications sont conservées.')); }
    finally { setSavingSettings(false); }
  }

  return <div className="dashboard-page admin-dashboard">
    <div className="dashboard-intro"><div><span className="portal-eyebrow">L’ESPACE ADMINISTRATION</span><h1>Pilotez <em>votre communauté.</em></h1><p>Gérez les accès et publiez les contenus de vos membres.</p></div><span className="live-label"><span aria-hidden="true" />Mis à jour en temps réel</span></div>
    <div className="admin-stats" aria-label="Membres affichés"><div className="stat-card"><span>Membres affichés</span><strong>{membersLoading ? '—' : members.length}</strong><small>Les 100 profils les plus récents</small></div><div className="stat-card stat-active"><span>Accès actifs</span><strong>{membersLoading ? '—' : counts.active}</strong><small>Dans les profils affichés</small></div><div className="stat-card"><span>En attente</span><strong>{membersLoading ? '—' : counts.pending}</strong><small>À vérifier après paiement</small></div><div className="stat-card"><span>Accès suspendus</span><strong>{membersLoading ? '—' : counts.suspended}</strong><small>Dans les profils affichés</small></div></div>
    <nav className="admin-tabs" aria-label="Sections d’administration">{([{ id: 'members', label: 'Membres' }, { id: 'announcements', label: 'Annonces' }, { id: 'application', label: 'Contenus' }, { id: 'audit', label: 'Journal des accès' }] as const).map(item => <button key={item.id} type="button" className={tab === item.id ? 'selected' : ''} onClick={() => setTab(item.id)} aria-pressed={tab === item.id}>{item.label}{item.id === 'members' && !membersLoading && <span>{members.length}</span>}</button>)}</nav>
    {tab === 'members' && <section className="portal-card members-panel" aria-label="Gestion des membres"><SectionHeading eyebrow="LE SUIVI DES COMPTES" title="Tous vos membres" /><p className="section-description">Après vérification du paiement de 2 000 DH, activez l’accès à vie du compte correspondant à l’e-mail reçu sur WhatsApp.</p><div className="member-controls"><label htmlFor="member-search" className="search-label"><span>Rechercher un membre</span><input id="member-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nom, e-mail ou identifiant" /></label><label htmlFor="member-filter"><span>Statut de l’accès</span><select id="member-filter" value={filter} onChange={event => setFilter(event.target.value as MembershipStatus | 'all')}><option value="all">Tous les statuts</option><option value="pending">En attente</option><option value="active">Accès actif</option><option value="suspended">Accès suspendu</option></select></label></div>
      {membersLoading ? <LoadingState label="Chargement des membres…" /> : membersError ? <Notice>{membersError}</Notice> : visible.length === 0 ? <EmptyState title={members.length ? 'Aucun résultat' : 'Votre premier membre arrive bientôt'}>{members.length ? 'Essayez un autre nom, e-mail ou filtre.' : 'Les nouveaux comptes apparaîtront ici dès leur inscription.'}</EmptyState> : <><div className="member-table-wrap" role="region" aria-label="Tableau des membres" tabIndex={0}><table className="member-table"><thead><tr><th scope="col">Membre</th><th scope="col">Inscription</th><th scope="col">Accès</th><th scope="col">Actions</th></tr></thead><tbody>{rows.map(member => { const memberStatus = member.entitlement?.status ?? 'pending'; return <tr key={member.uid}><td><div className="member-identity"><span className="member-avatar" aria-hidden="true">{(member.profile.displayName || member.profile.email).slice(0, 2).toUpperCase()}</span><div><strong>{member.profile.displayName || 'Membre'}</strong><span className="member-email">{member.profile.email}</span><span className="member-uid">{member.uid}</span></div></div></td><td className="member-date">{formatDate(member.profile.createdAt)}</td><td><StatusBadge status={memberStatus} /></td><td><div className="member-actions"><button type="button" className="member-action action-activate" disabled={!!rowBusy[member.uid] || memberStatus === 'active'} onClick={() => changeStatus(member, 'active')} aria-label={`Activer l’accès de ${member.profile.email}`}>{rowBusy[member.uid] === 'active' ? 'Activation…' : 'Activer'}</button><button type="button" className="member-action" disabled={!!rowBusy[member.uid] || memberStatus === 'pending'} onClick={() => changeStatus(member, 'pending')} aria-label={`Mettre l’accès de ${member.profile.email} en attente`}>{rowBusy[member.uid] === 'pending' ? 'Mise à jour…' : 'En attente'}</button><button type="button" className="member-action action-suspend" disabled={!!rowBusy[member.uid] || memberStatus === 'suspended'} onClick={() => changeStatus(member, 'suspended')} aria-label={`Suspendre l’accès de ${member.profile.email}`}>{rowBusy[member.uid] === 'suspended' ? 'Suspension…' : 'Suspendre'}</button></div>{rowErrors[member.uid] && <div className="row-error" role="alert">{rowErrors[member.uid]}</div>}</td></tr>; })}</tbody></table></div><div className="table-pagination"><span>{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, visible.length)} sur {visible.length} membres</span><div className="button-row"><button className="portal-button button-outline button-small" type="button" onClick={() => setPage(value => Math.max(1, value - 1))} disabled={currentPage === 1}>Précédent</button><span className="page-number">{currentPage} / {lastPage}</span><button className="portal-button button-outline button-small" type="button" onClick={() => setPage(value => Math.min(lastPage, value + 1))} disabled={currentPage === lastPage}>Suivant</button></div></div></>}
    </section>}
    {tab === 'announcements' && <div className="admin-two-column"><section className="portal-card"><SectionHeading eyebrow="PARLEZ À VOS MEMBRES" title="Une nouvelle annonce" /><p className="section-description">Votre message apparaît dans les espaces membres dès sa publication.</p><form className="portal-form" onSubmit={publishAnnouncement}><label htmlFor="announcement-title">Titre<input id="announcement-title" value={announcementTitle} onChange={event => setAnnouncementTitle(event.target.value)} minLength={3} maxLength={120} disabled={posting} placeholder="L’essentiel en quelques mots" required /></label><label htmlFor="announcement-body">Message<textarea id="announcement-body" value={announcementBody} onChange={event => setAnnouncementBody(event.target.value)} minLength={10} maxLength={2000} rows={7} disabled={posting} placeholder="Partagez une mise à jour avec vos membres…" required /></label>{postError && <Notice>{postError}</Notice>}{postSuccess && <Notice kind="success">{postSuccess}</Notice>}{lastPublishedId && pushBusy[lastPublishedId] && <Notice kind="info">L’envoi des notifications est en cours…</Notice>}{lastPublishedId && pushMessages[lastPublishedId] && <Notice kind="info">{pushMessages[lastPublishedId]}</Notice>}<button type="submit" className="portal-button button-gold" disabled={posting}>{posting ? 'Publication…' : 'Publier l’annonce'}<ArrowIcon /></button></form></section><section className="portal-card"><SectionHeading eyebrow="DÉJÀ EN LIGNE" title="Annonces publiées" />{newsLoading ? <LoadingState /> : newsError ? <Notice>{newsError}</Notice> : announcements.length === 0 ? <EmptyState title="La page est à vous">Votre première annonce apparaîtra ici.</EmptyState> : <div className="announcement-list">{announcements.map(item => <article key={item.id} className="announcement-item"><time>{formatDate(item.createdAt)}</time><h3>{item.title}</h3><p>{item.body}</p><div className="announcement-actions"><button type="button" className="text-button" disabled={pushBusy[item.id]} onClick={() => sendNotification(item.id)}>{pushBusy[item.id] ? 'Envoi en cours…' : 'Envoyer l’alerte push'}</button>{deleteConfirm === item.id ? <><span>Supprimer cette annonce ?</span><button type="button" className="text-button danger-text" disabled={!!deleting} onClick={() => removeAnnouncement(item.id)}>{deleting === item.id ? 'Suppression…' : 'Oui, supprimer'}</button><button type="button" className="text-button" disabled={!!deleting} onClick={() => setDeleteConfirm(null)}>Annuler</button></> : <button type="button" className="text-button danger-text" disabled={!!deleting} onClick={() => setDeleteConfirm(item.id)}>Supprimer</button>}</div>{pushMessages[item.id] && <Notice kind="info">{pushMessages[item.id]}</Notice>}{deleteErrors[item.id] && <Notice>{deleteErrors[item.id]}</Notice>}</article>)}</div>}</section></div>}
    {tab === 'application' && <section className="portal-card settings-panel"><SectionHeading eyebrow="L’ESPACE DES MEMBRES ACTIFS" title="Vidéos, broker et application" /><p className="section-description">Ces contenus sont réservés aux comptes dont l’accès est actif. Enregistrez vos modifications pour les rendre disponibles en temps réel.</p>{applicationLoading ? <LoadingState /> : applicationError ? <Notice>{applicationError}</Notice> : <form className="portal-form" onSubmit={persistSettings}><div className="settings-section"><h3>Votre espace XAUUSD</h3><div className="settings-fields"><label htmlFor="app-title">Titre<input id="app-title" value={appTitle} onChange={event => { setAppTitle(event.target.value); setSettingsDirty(true); setSettingsSuccess(''); }} minLength={3} maxLength={120} disabled={savingSettings} required /></label><label htmlFor="app-description">Présentation<textarea id="app-description" value={appDescription} onChange={event => { setAppDescription(event.target.value); setSettingsDirty(true); setSettingsSuccess(''); }} maxLength={2000} rows={3} disabled={savingSettings} required placeholder="Quelques mots pour présenter votre espace" /></label></div></div>
      <div className="settings-section"><div className="settings-section-heading"><div><h3>01 — Vidéos explicatives</h3><p>Guidez vos membres pas à pas, depuis les bases. Les vidéos sont affichées dans cet ordre.</p></div><button type="button" className="portal-button button-outline button-small" disabled={savingSettings || videos.length >= 10} onClick={() => { setVideos(value => [...value, { id: crypto.randomUUID(), title: '', url: '' }]); setSettingsDirty(true); setSettingsSuccess(''); }}>+ Ajouter une vidéo</button></div>{videos.length === 0 ? <div className="settings-empty">Aucune vidéo ajoutée. Ajoutez votre première vidéo pour commencer.</div> : <div className="video-editor-list">{videos.map((video, index) => <div className="video-editor" key={video.id}><span className="video-editor-number">{String(index + 1).padStart(2, '0')}</span><div className="video-editor-fields"><label htmlFor={`video-title-${video.id}`}>Titre de la vidéo<input id={`video-title-${video.id}`} value={video.title} onChange={event => changeVideo(video.id, 'title', event.target.value)} minLength={3} maxLength={120} disabled={savingSettings} placeholder="Ex. Bien démarrer" required /></label><label htmlFor={`video-url-${video.id}`}>Lien HTTPS<input id={`video-url-${video.id}`} type="url" inputMode="url" value={video.url} onChange={event => changeVideo(video.id, 'url', event.target.value)} maxLength={2048} disabled={savingSettings} placeholder="https://…" required /></label></div><button type="button" className="text-button danger-text" disabled={savingSettings} onClick={() => { setVideos(value => value.filter(item => item.id !== video.id)); setSettingsDirty(true); setSettingsSuccess(''); }} aria-label={`Retirer la vidéo ${index + 1}`}>Retirer</button></div>)}</div>}<span className="field-help">Jusqu’à 10 vidéos. Utilisez des liens accessibles à vos membres.</span></div>
      <div className="settings-section"><h3>02 — Lien du broker affilié</h3><p>Ajoutez votre lien d’affiliation pour permettre aux membres d’ouvrir un compte chez votre broker partenaire.</p><label htmlFor="broker-url">Lien du broker<input id="broker-url" type="url" inputMode="url" value={brokerUrl} onChange={event => { setBrokerUrl(event.target.value); setSettingsDirty(true); setSettingsSuccess(''); }} maxLength={2048} disabled={savingSettings} placeholder="https://…" /><span className="field-help">Vous pouvez laisser ce champ vide jusqu’à la mise à disposition de votre lien.</span></label></div>
      <div className="settings-section"><h3>Lien complémentaire de l’application</h3><label htmlFor="download-url">Lien de l’application — facultatif<input id="download-url" type="url" inputMode="url" value={downloadUrl} onChange={event => { setDownloadUrl(event.target.value); setSettingsDirty(true); setSettingsSuccess(''); }} maxLength={2048} disabled={savingSettings} placeholder="https://…" /></label></div>
      {settingsError && <Notice>{settingsError}</Notice>}{settingsSuccess && <Notice kind="success">{settingsSuccess}</Notice>}<div className="settings-footer"><button className="portal-button button-gold" type="submit" disabled={savingSettings || !settingsDirty}>{savingSettings ? 'Enregistrement…' : 'Enregistrer les contenus'}<ArrowIcon /></button>{application && <span>Dernière mise à jour : {formatDate(application.updatedAt)}</span>}</div>
    </form>}</section>}
    {tab === 'audit' && <section className="portal-card"><SectionHeading eyebrow="UN HISTORIQUE TRAÇABLE" title="Journal des accès" /><p className="section-description">Les 50 changements de statut les plus récents, avec le membre concerné et l’administrateur à l’origine du changement.</p>{auditLoading ? <LoadingState /> : auditError ? <Notice>{auditError}</Notice> : audit.length === 0 ? <EmptyState title="Aucun changement pour le moment">Les activations et suspensions apparaîtront ici.</EmptyState> : <ol className="admin-audit-list">{audit.map(item => <li key={item.id}><div className="audit-main"><span className="audit-dot" aria-hidden="true" /><div><strong>{memberName(item.memberUid)}</strong><span>{item.previousStatus ? statusLabels[item.previousStatus] : 'Sans accès'} <span aria-hidden="true">→</span> {statusLabels[item.status]}</span><small>Par : {memberName(item.actorUid)}</small></div></div><div className="audit-meta"><StatusBadge status={item.status} /><time>{formatDate(item.createdAt)}</time></div></li>)}</ol>}</section>}
  </div>;
}
