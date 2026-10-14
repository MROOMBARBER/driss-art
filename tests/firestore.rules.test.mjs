import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

let environment;
let owner;
let other;
let admin;
let guest;

const profile = (name, email) => ({
  displayName: name,
  email,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-xauusd',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  });
  owner = environment.authenticatedContext('member-one', { email: 'one@example.test' }).firestore();
  other = environment.authenticatedContext('member-two', { email: 'two@example.test' }).firestore();
  admin = environment.authenticatedContext('admin-one', { admin: true, email: 'admin@example.test' }).firestore();
  guest = environment.unauthenticatedContext().firestore();
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore();
    await Promise.all([
      setDoc(doc(store, 'users', 'member-one'), profile('Member One', 'one@example.test')),
      setDoc(doc(store, 'users', 'member-two'), profile('Member Two', 'two@example.test')),
    ]);
  });
});

after(async () => {
  await environment?.cleanup();
});

function changeStatus({ uid = 'member-one', status = 'active', previousStatus = null, auditId = 'change-one', actorUid = 'admin-one', entitlementOverrides = {}, auditOverrides = {}, store = admin } = {}) {
  const batch = writeBatch(store);
  batch.set(doc(store, 'entitlements', uid), {
    status,
    plan: 'xauusd-lifetime',
    priceMad: 2000,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
    lastAuditId: auditId,
    ...entitlementOverrides,
  });
  batch.set(doc(store, 'auditLogs', auditId), {
    memberUid: uid,
    actorUid,
    status,
    previousStatus,
    createdAt: serverTimestamp(),
    ...auditOverrides,
  });
  return batch.commit();
}

test('a member can create only their own profile with token email and exact schema', async () => {
  const newlyRegistered = environment.authenticatedContext('new-member', { email: 'new@example.test' }).firestore();
  await assertSucceeds(setDoc(doc(newlyRegistered, 'users', 'new-member'), profile('New Member', 'new@example.test')));
  await assertFails(setDoc(doc(newlyRegistered, 'users', 'someone-else'), profile('Other', 'new@example.test')));
  const missing = environment.authenticatedContext('missing-member', { email: 'correct@example.test' }).firestore();
  await assertFails(setDoc(doc(missing, 'users', 'missing-member'), profile('Member', 'wrong@example.test')));
  await assertFails(setDoc(doc(missing, 'users', 'missing-member'), {
    ...profile('Member', 'correct@example.test'),
    admin: true,
  }));
  await assertFails(setDoc(doc(missing, 'users', 'missing-member'), {
    ...profile('Member', 'correct@example.test'),
    createdAt: Timestamp.fromMillis(0),
  }));
});

test('profile isolation, immutable email/creation time and restricted name changes', async () => {
  await assertSucceeds(getDoc(doc(owner, 'users', 'member-one')));
  await assertFails(getDoc(doc(other, 'users', 'member-one')));
  await assertFails(getDoc(doc(guest, 'users', 'member-one')));
  await assertSucceeds(updateDoc(doc(owner, 'users', 'member-one'), { displayName: 'Updated Name', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(owner, 'users', 'member-one'), { email: 'replacement@example.test', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(owner, 'users', 'member-one'), { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(owner, 'users', 'member-one'), { displayName: '', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(owner, 'users', 'member-one'), { displayName: 'Forged time', updatedAt: Timestamp.fromMillis(0) }));
  await assertFails(updateDoc(doc(admin, 'users', 'member-one'), { displayName: 'Admin cannot impersonate owner', updatedAt: serverTimestamp() }));
});

test('user directories are admin-only and bounded', async () => {
  await assertFails(getDocs(query(collection(owner, 'users'), limit(100))));
  await assertFails(getDocs(query(collection(guest, 'users'), limit(100))));
  await assertSucceeds(getDocs(query(collection(admin, 'users'), orderBy('createdAt', 'desc'), limit(100))));
  await assertFails(getDocs(collection(admin, 'users')));
  await assertFails(getDocs(query(collection(admin, 'users'), limit(101))));
});

test('a member cannot activate access, set a role or forge an audit record', async () => {
  await assertFails(changeStatus({ store: owner, actorUid: 'member-one' }));
  await assertFails(updateDoc(doc(owner, 'users', 'member-one'), { admin: true, updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(owner, 'auditLogs', 'forged'), {
    memberUid: 'member-one', actorUid: 'member-one', status: 'active', previousStatus: null, createdAt: serverTimestamp(),
  }));
  const falseAdmin = environment.authenticatedContext('false-admin', { admin: 'true' }).firestore();
  await assertFails(changeStatus({ store: falseAdmin, actorUid: 'false-admin' }));
});

test('admin activation and suspension atomically append an immutable audit trail', async () => {
  await assertSucceeds(changeStatus());
  assert.equal((await getDoc(doc(owner, 'entitlements', 'member-one'))).data().status, 'active');
  await assertSucceeds(changeStatus({ status: 'suspended', previousStatus: 'active', auditId: 'change-two' }));
  const record = (await getDoc(doc(owner, 'entitlements', 'member-one'))).data();
  assert.equal(record.status, 'suspended');
  assert.equal(record.priceMad, 2000);
  const history = await getDocs(query(collection(admin, 'auditLogs'), orderBy('createdAt', 'desc'), limit(50)));
  assert.equal(history.size, 2);
  await assertFails(updateDoc(doc(admin, 'auditLogs', 'change-one'), { status: 'suspended' }));
  await assertFails(deleteDoc(doc(admin, 'auditLogs', 'change-one')));
  await assertFails(deleteDoc(doc(admin, 'entitlements', 'member-one')));
});

test('entitlement updates require a matching new audit in the same atomic operation', async () => {
  await assertFails(setDoc(doc(admin, 'entitlements', 'member-one'), {
    status: 'active', plan: 'xauusd-lifetime', priceMad: 2000,
    updatedAt: serverTimestamp(), updatedBy: 'admin-one', lastAuditId: 'absent',
  }));
  await assertFails(changeStatus({ auditOverrides: { status: 'suspended' } }));
  await assertFails(changeStatus({ auditOverrides: { actorUid: 'other-admin' } }));
  await assertFails(changeStatus({ auditOverrides: { createdAt: Timestamp.fromMillis(0) } }));
  await assertFails(changeStatus({ previousStatus: 'active' }));
  await assertFails(changeStatus({ entitlementOverrides: { priceMad: 1 } }));
  await assertFails(changeStatus({ entitlementOverrides: { plan: 'other-plan' } }));
  await assertFails(changeStatus({ status: 'unknown' }));
  await assertFails(changeStatus({ uid: 'nonexistent-member' }));
  assert.equal((await getDoc(doc(owner, 'entitlements', 'member-one'))).exists(), false);
  await assertSucceeds(changeStatus());
  await assertFails(changeStatus({ status: 'suspended', previousStatus: 'pending', auditId: 'wrong-history' }));
  await assertFails(changeStatus({ status: 'suspended', previousStatus: 'active', auditId: 'change-one' }));
  assert.equal((await getDoc(doc(owner, 'entitlements', 'member-one'))).data().status, 'active');
});

test('a standalone admin audit append is denied', async () => {
  await assertFails(setDoc(doc(admin, 'auditLogs', 'standalone'), {
    memberUid: 'member-one', actorUid: 'admin-one', status: 'active', previousStatus: null, createdAt: serverTimestamp(),
  }));
});

test('entitlements and history remain isolated and history queries must select the owner', async () => {
  await assertSucceeds(changeStatus());
  await assertFails(getDoc(doc(other, 'entitlements', 'member-one')));
  await assertFails(getDoc(doc(guest, 'entitlements', 'member-one')));
  await assertFails(getDocs(query(collection(owner, 'entitlements'), limit(30))));
  await assertSucceeds(getDocs(query(collection(admin, 'entitlements'), limit(30))));
  await assertSucceeds(getDoc(doc(owner, 'auditLogs', 'change-one')));
  await assertFails(getDoc(doc(other, 'auditLogs', 'change-one')));
  await assertFails(getDocs(query(collection(owner, 'auditLogs'), limit(50))));
  await assertSucceeds(getDocs(query(collection(owner, 'auditLogs'), where('memberUid', '==', 'member-one'), orderBy('createdAt', 'desc'), limit(50))));
  await assertFails(getDocs(query(collection(other, 'auditLogs'), where('memberUid', '==', 'member-one'), limit(50))));
});

test('announcements are visible to authenticated members and writable only by admin', async () => {
  const announcement = { title: 'Nouvelle version', body: 'Une mise à jour est disponible.', createdAt: serverTimestamp(), createdBy: 'admin-one' };
  await assertFails(setDoc(doc(owner, 'announcements', 'message'), { ...announcement, createdBy: 'member-one' }));
  await assertFails(setDoc(doc(admin, 'announcements', 'message'), { ...announcement, createdBy: 'someone-else' }));
  await assertFails(setDoc(doc(admin, 'announcements', 'message'), { ...announcement, title: 'x'.repeat(121) }));
  await assertFails(setDoc(doc(admin, 'announcements', 'message'), { ...announcement, pushStatus: 'sent' }));
  await assertSucceeds(setDoc(doc(admin, 'announcements', 'message'), announcement));
  await assertSucceeds(getDocs(query(collection(owner, 'announcements'), orderBy('createdAt', 'desc'), limit(25))));
  await assertFails(getDocs(query(collection(guest, 'announcements'), limit(25))));
  await assertFails(updateDoc(doc(admin, 'announcements', 'message'), { title: 'Edited' }));
  await assertFails(deleteDoc(doc(owner, 'announcements', 'message')));
  await assertSucceeds(deleteDoc(doc(admin, 'announcements', 'message')));
});

test('server-only delivery receipts are unreadable and unwritable from every browser role', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'announcements', 'message', 'pushReceipts', 'receipt'), { status: 'sent', processedAt: serverTimestamp() });
  });
  await assertFails(getDoc(doc(admin, 'announcements', 'message', 'pushReceipts', 'receipt')));
  await assertFails(getDoc(doc(owner, 'announcements', 'message', 'pushReceipts', 'receipt')));
  await assertFails(setDoc(doc(admin, 'announcements', 'message', 'pushReceipts', 'fake'), { status: 'sent', processedAt: serverTimestamp() }));
});

test('application HTTPS link is controlled by admin and visible only with active access', async () => {
  const settings = {
    title: 'Application XAUUSD', description: 'Installation de votre application.', downloadUrl: 'https://downloads.example.test/application',
    brokerUrl: 'https://broker.example.test/affiliation', videos: [{ id: 'intro', title: 'Débuter', url: 'https://videos.example.test/intro' }],
    updatedAt: serverTimestamp(), updatedBy: 'admin-one',
  };
  await assertFails(setDoc(doc(owner, 'settings', 'application'), { ...settings, updatedBy: 'member-one' }));
  await assertFails(setDoc(doc(admin, 'settings', 'application'), { ...settings, downloadUrl: 'javascript:alert(1)' }));
  await assertFails(setDoc(doc(admin, 'settings', 'application'), { ...settings, downloadUrl: 'http://example.test/app' }));
  await assertFails(setDoc(doc(admin, 'settings', 'application'), { ...settings, downloadUrl: 'https://example.test/ app' }));
  await assertFails(setDoc(doc(admin, 'settings', 'application'), { ...settings, downloadUrl: 'https://?invalid' }));
  await assertFails(setDoc(doc(admin, 'settings', 'application'), { ...settings, brokerUrl: 'javascript:alert(1)' }));
  await assertFails(setDoc(doc(admin, 'settings', 'application'), { ...settings, videos: [{ id: 'intro', title: 'Unsafe', url: 'javascript:alert(1)' }] }));
  await assertFails(setDoc(doc(admin, 'settings', 'application'), { ...settings, videos: Array(11).fill(settings.videos[0]) }));
  await assertFails(setDoc(doc(admin, 'settings', 'application'), { ...settings, videos: Array(10).fill(settings.videos[0]).map((video, index) => index === 9 ? { ...video, url: 'http://unsafe.example.test' } : video) }));
  await assertSucceeds(setDoc(doc(admin, 'settings', 'application'), {
    ...settings,
    videos: Array.from({ length: 10 }, (_, index) => ({ ...settings.videos[0], id: `video-${index}` })),
  }));
  await assertSucceeds(setDoc(doc(admin, 'settings', 'application'), settings));
  await assertSucceeds(getDoc(doc(admin, 'settings', 'application')));
  await assertFails(getDoc(doc(owner, 'settings', 'application')));
  await assertFails(getDoc(doc(guest, 'settings', 'application')));
  await assertSucceeds(changeStatus());
  await assertSucceeds(getDoc(doc(owner, 'settings', 'application')));
  await assertFails(getDoc(doc(other, 'settings', 'application')));
  await assertSucceeds(changeStatus({ status: 'suspended', previousStatus: 'active', auditId: 'suspension' }));
  await assertFails(getDoc(doc(owner, 'settings', 'application')));
});

test('only an active owner can register/read their device token; revoked owners can remove it', async () => {
  const tokenHash = 'a'.repeat(64);
  const token = { token: 'example-device-token', createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  const ownerReference = doc(owner, 'pushTokens', 'member-one', 'tokens', tokenHash);
  await assertFails(setDoc(ownerReference, token));
  await assertSucceeds(changeStatus());
  await assertFails(setDoc(doc(owner, 'pushTokens', 'member-one', 'tokens', 'bad-id'), token));
  await assertFails(setDoc(doc(other, 'pushTokens', 'member-one', 'tokens', tokenHash), token));
  await assertFails(setDoc(doc(admin, 'pushTokens', 'member-one', 'tokens', tokenHash), token));
  await assertSucceeds(setDoc(ownerReference, token));
  await assertSucceeds(getDoc(ownerReference));
  await assertFails(getDoc(doc(other, 'pushTokens', 'member-one', 'tokens', tokenHash)));
  await assertFails(getDoc(doc(admin, 'pushTokens', 'member-one', 'tokens', tokenHash)));
  await assertFails(updateDoc(ownerReference, { token: 'changed-token', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ownerReference, { updatedAt: serverTimestamp() }));
  await assertSucceeds(changeStatus({ status: 'suspended', previousStatus: 'active', auditId: 'revoke-push' }));
  await assertFails(getDoc(ownerReference));
  await assertFails(updateDoc(ownerReference, { updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(owner, 'pushTokens', 'member-one', 'tokens', 'b'.repeat(64)), token));
  await assertSucceeds(deleteDoc(ownerReference));
});

test('an owner listener receives an admin activation in real time', async () => {
  let unsubscribe;
  let receivedInitial;
  const initial = new Promise((resolve) => { receivedInitial = resolve; });
  const changed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { unsubscribe?.(); reject(new Error('Realtime update was not received.')); }, 5000);
    unsubscribe = onSnapshot(doc(owner, 'entitlements', 'member-one'), (snapshot) => {
      receivedInitial();
      if (snapshot.data()?.status === 'active') {
        clearTimeout(timeout);
        unsubscribe();
        resolve(snapshot.data());
      }
    }, (error) => { clearTimeout(timeout); reject(error); });
  });
  await initial;
  await assertSucceeds(changeStatus());
  assert.equal((await changed).status, 'active');
});
