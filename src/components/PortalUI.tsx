import type { ReactNode } from 'react';
import type { MembershipStatus } from '../lib/types';

export const statusLabels: Record<MembershipStatus, string> = {
  pending: 'En attente',
  active: 'Accès actif',
  suspended: 'Accès suspendu',
};

export function StatusBadge({ status }: { status: MembershipStatus }) {
  return <span className={`status-badge status-${status}`}><span aria-hidden="true" />{statusLabels[status]}</span>;
}

export function formatDate(value: unknown) {
  if (!value || typeof value !== 'object' || !('toDate' in value) || typeof value.toDate !== 'function') return 'À l’instant';
  const date: Date = value.toDate();
  if (Number.isNaN(date.getTime())) return 'À l’instant';
  return new Intl.DateTimeFormat('fr-MA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Casablanca' }).format(date);
}

export function friendlyError(error: unknown, fallback = 'Une erreur est survenue. Réessayez dans un instant.') {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code.includes('network-request-failed') || code.includes('unavailable')) return 'Connexion interrompue. Vérifiez votre connexion puis réessayez.';
  if (code.includes('too-many-requests')) return 'Trop de tentatives. Patientez quelques minutes avant de réessayer.';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found') || code.includes('invalid-login-credentials')) return 'Adresse e-mail ou mot de passe incorrect.';
  if (code.includes('email-already-in-use')) return 'Cette adresse e-mail possède déjà un compte. Connectez-vous ou réinitialisez votre mot de passe.';
  if (code.includes('invalid-email')) return 'Saisissez une adresse e-mail valide.';
  if (code.includes('weak-password')) return 'Choisissez un mot de passe plus long et plus difficile à deviner.';
  if (code.includes('permission-denied')) return 'Vous ne pouvez pas accéder à ces informations pour le moment. Contactez le support si le problème persiste.';
  if (code.includes('user-disabled')) return 'Ce compte est désactivé. Contactez le support.';
  if (code.includes('operation-not-allowed')) return 'Ce service est temporairement indisponible. Contactez le support.';
  return fallback;
}

export function Notice({ children, kind = 'error' }: { children: ReactNode; kind?: 'error' | 'success' | 'info' }) {
  return <div className={`portal-notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="portal-empty"><span className="empty-mark" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="m12 3 9 9-9 9-9-9 9-9Z" stroke="currentColor" strokeWidth="1.3" /></svg></span><strong>{title}</strong><p>{children}</p></div>;
}

export function LoadingState({ label = 'Chargement en cours…' }: { label?: string }) {
  return <div className="portal-loading" role="status"><span className="portal-spinner" aria-hidden="true" />{label}</div>;
}

export function SectionHeading({ eyebrow, title, children, id }: { eyebrow?: string; title: string; children?: ReactNode; id?: string }) {
  return <div className="section-heading"><div>{eyebrow && <span className="portal-eyebrow">{eyebrow}</span>}<h2 id={id}>{title}</h2></div>{children}</div>;
}

export const supportUrl = (message: string) => `https://wa.me/212751019600?text=${encodeURIComponent(message)}`;

export function ArrowIcon() {
  return <svg viewBox="0 0 24 24" fill="none" width="18" height="18" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function SpaceIcon({ kind }: { kind: 'video' | 'broker' | 'notification' }) {
  return <svg viewBox="0 0 24 24" fill="none" width="22" height="22" aria-hidden="true" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {kind === 'video' ? <path d="m8 5 11 7-11 7V5Z" /> : kind === 'broker' ? <path d="M6 18 18 6M6 6h12v12" /> : <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /><path d="M12 2V1" /></>}
  </svg>;
}
