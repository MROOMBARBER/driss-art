import type { User } from 'firebase/auth';
import { getIdTokenResult } from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  documentId,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
  type FirestoreError,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import type {
  Announcement,
  ApplicationVideo,
  ApplicationSettings,
  AuditEntry,
  Entitlement,
  MemberRecord,
  MembershipStatus,
  UserProfile,
} from './types';

type WatchError = (error: FirestoreError) => void;
const membershipStatuses: MembershipStatus[] = ['pending', 'active', 'suspended'];

function database(): Firestore {
  if (!db) throw new Error('La connexion Firebase doit être configurée.');
  return db;
}

function memberId(uid: string): string {
  if (!uid || uid.includes('/') || uid.length > 128) throw new Error('Identifiant utilisateur invalide.');
  return uid;
}

function requiredText(value: string, maxLength: number, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${label} doit contenir entre 1 et ${maxLength} caractères.`);
  }
  return normalized;
}

async function administrator(): Promise<string> {
  const user = auth?.currentUser;
  if (!user || (await getIdTokenResult(user)).claims.admin !== true) {
    throw new Error('Un compte administrateur est nécessaire.');
  }
  return user.uid;
}

export async function ensureProfile(user: User, displayName?: string): Promise<void> {
  const store = database();
  if (!user.email) throw new Error('Une adresse e-mail est nécessaire.');
  const name = requiredText(displayName || user.displayName || user.email.split('@')[0], 80, 'Le nom');
  const reference = doc(store, 'users', memberId(user.uid));
  await runTransaction(store, async (transaction) => {
    const current = await transaction.get(reference);
    if (current.exists()) return;
    transaction.set(reference, {
      displayName: name,
      email: user.email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
}

export function watchProfile(
  uid: string,
  next: (profile: UserProfile | null) => void,
  error: WatchError,
): Unsubscribe {
  return onSnapshot(doc(database(), 'users', memberId(uid)), (snapshot) => {
    next(snapshot.exists() ? snapshot.data() as UserProfile : null);
  }, error);
}

export async function updateDisplayName(uid: string, displayName: string): Promise<void> {
  await updateDoc(doc(database(), 'users', memberId(uid)), {
    displayName: requiredText(displayName, 80, 'Le nom'),
    updatedAt: serverTimestamp(),
  });
}

export function watchEntitlement(
  uid: string,
  next: (entitlement: Entitlement | null) => void,
  error: WatchError,
): Unsubscribe {
  return onSnapshot(doc(database(), 'entitlements', memberId(uid)), (snapshot) => {
    next(snapshot.exists() ? snapshot.data() as Entitlement : null);
  }, error);
}

// Keep the initial directory bounded. Entitlements are listened to only for the
// visible members, so an old entitlement cannot disappear behind a global limit.
export function watchMembers(next: (members: MemberRecord[]) => void, error: WatchError): Unsubscribe {
  const store = database();
  let entitlementListeners: Unsubscribe[] = [];
  let stopped = false;
  let generation = 0;
  const stopEntitlements = () => {
    entitlementListeners.forEach((unsubscribe) => unsubscribe());
    entitlementListeners = [];
  };
  const stopUsers = onSnapshot(
    query(collection(store, 'users'), orderBy('createdAt', 'desc'), limit(100)),
    (snapshot) => {
      stopEntitlements();
      const currentGeneration = ++generation;
      const members = snapshot.docs.map((item): MemberRecord => ({
        uid: item.id,
        profile: item.data() as UserProfile,
        entitlement: null,
      }));
      if (!members.length) {
        next([]);
        return;
      }
      const entitlementMap = new Map<string, Entitlement>();
      const chunks: string[][] = [];
      for (let offset = 0; offset < members.length; offset += 30) {
        chunks.push(members.slice(offset, offset + 30).map((member) => member.uid));
      }
      const ready = new Set<number>();
      chunks.forEach((uids, index) => {
        const unsubscribe = onSnapshot(
          query(collection(store, 'entitlements'), where(documentId(), 'in', uids), orderBy(documentId()), limit(30)),
          (entitlements) => {
            if (stopped || generation !== currentGeneration) return;
            uids.forEach((uid) => entitlementMap.delete(uid));
            entitlements.docs.forEach((item) => entitlementMap.set(item.id, item.data() as Entitlement));
            ready.add(index);
            if (ready.size === chunks.length) {
              next(members.map((member) => ({ ...member, entitlement: entitlementMap.get(member.uid) ?? null })));
            }
          },
          error,
        );
        entitlementListeners.push(unsubscribe);
      });
    },
    error,
  );
  return () => {
    stopped = true;
    ++generation;
    stopUsers();
    stopEntitlements();
  };
}

export async function setMemberStatus(uid: string, status: MembershipStatus): Promise<void> {
  if (!membershipStatuses.includes(status)) throw new Error('Statut invalide.');
  const actorUid = await administrator();
  const store = database();
  const entitlementReference = doc(store, 'entitlements', memberId(uid));
  const auditReference = doc(collection(store, 'auditLogs'));
  // The transaction records the actual previous status even when another admin
  // edits the same member concurrently. Rules require both writes together.
  await runTransaction(store, async (transaction) => {
    const previous = await transaction.get(entitlementReference);
    transaction.set(entitlementReference, {
      status,
      plan: 'xauusd-lifetime',
      priceMad: 2000,
      updatedAt: serverTimestamp(),
      updatedBy: actorUid,
      lastAuditId: auditReference.id,
    });
    transaction.set(auditReference, {
      memberUid: uid,
      actorUid,
      status,
      previousStatus: previous.exists() ? previous.data().status : null,
      createdAt: serverTimestamp(),
    });
  });
}

export function watchAuditLogs(next: (entries: AuditEntry[]) => void, error: WatchError): Unsubscribe {
  return onSnapshot(
    query(collection(database(), 'auditLogs'), orderBy('createdAt', 'desc'), limit(50)),
    (snapshot) => next(snapshot.docs.map((item) => ({ ...item.data(), id: item.id } as AuditEntry))),
    error,
  );
}

export function watchMemberAudit(
  uid: string,
  next: (entries: AuditEntry[]) => void,
  error: WatchError,
): Unsubscribe {
  return onSnapshot(
    query(collection(database(), 'auditLogs'), where('memberUid', '==', memberId(uid)), orderBy('createdAt', 'desc'), limit(50)),
    (snapshot) => next(snapshot.docs.map((item) => ({ ...item.data(), id: item.id } as AuditEntry))),
    error,
  );
}

export function watchAnnouncements(next: (announcements: Announcement[]) => void, error: WatchError): Unsubscribe {
  return onSnapshot(
    query(collection(database(), 'announcements'), orderBy('createdAt', 'desc'), limit(25)),
    (snapshot) => next(snapshot.docs.map((item) => ({ ...item.data(), id: item.id } as Announcement))),
    error,
  );
}

export async function saveAnnouncement(input: { title: string; body: string }): Promise<string> {
  const createdBy = await administrator();
  const reference = await addDoc(collection(database(), 'announcements'), {
    title: requiredText(input.title, 120, 'Le titre'),
    body: requiredText(input.body, 2000, 'Le message'),
    createdAt: serverTimestamp(),
    createdBy,
  });
  return reference.id;
}

export async function deleteAnnouncement(id: string): Promise<void> {
  await administrator();
  await deleteDoc(doc(database(), 'announcements', memberId(id)));
}

export function watchApplication(next: (settings: ApplicationSettings | null) => void, error: WatchError): Unsubscribe {
  return onSnapshot(doc(database(), 'settings', 'application'), (snapshot) => {
    next(snapshot.exists() ? snapshot.data() as ApplicationSettings : null);
  }, error);
}

function httpsUrl(value: string, optional = false): string {
  const normalized = value.trim();
  if (optional && !normalized) return '';
  const externalUrl = requiredText(normalized, 2048, 'Le lien');
  let url: URL;
  try {
    url = new URL(externalUrl);
  } catch {
    throw new Error('Le lien doit être une URL HTTPS valide.');
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || /\s/.test(externalUrl)) {
    throw new Error('Le lien doit utiliser HTTPS.');
  }
  return url.href;
}

export async function saveApplication(input: {
  title: string;
  description: string;
  downloadUrl: string;
  brokerUrl: string;
  videos: ApplicationVideo[];
}): Promise<void> {
  const updatedBy = await administrator();
  if (!Array.isArray(input.videos) || input.videos.length > 10) {
    throw new Error('Ajoutez au maximum 10 vidéos.');
  }
  const videos = input.videos.map((video) => ({
    id: requiredText(video.id, 80, 'L’identifiant de la vidéo'),
    title: requiredText(video.title, 120, 'Le titre de la vidéo'),
    url: httpsUrl(video.url),
  }));
  await setDoc(doc(database(), 'settings', 'application'), {
    title: requiredText(input.title, 120, 'Le titre'),
    description: requiredText(input.description, 2000, 'La description'),
    downloadUrl: httpsUrl(input.downloadUrl, true),
    brokerUrl: httpsUrl(input.brokerUrl, true),
    videos,
    updatedAt: serverTimestamp(),
    updatedBy,
  });
}
