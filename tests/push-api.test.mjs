import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createPushHandler } from '../api/admin/push.mjs';

const CLOCK = 1800000000000;
const hash = (token) => createHash('sha256').update(token).digest('hex');
const tokenFor = (uid) => `fcm-registration-token-for-${uid}`;

function fakeFirestore(initial = {}) {
  const documents = new Map(Object.entries(initial).map(([path, value]) => [path, structuredClone(value)]));
  const effects = [];
  let transactionTail = Promise.resolve();
  function ref(path) {
    return { path, id: path.split('/').at(-1), collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }) };
  }
  function snapshot(documentRef) {
    const value = documents.get(documentRef.path);
    return { ref: documentRef, id: documentRef.id, exists: value !== undefined, data: () => structuredClone(value) };
  }
  function query(limit = Infinity, cursor) {
    return {
      orderBy: () => query(limit, cursor),
      limit: (count) => query(count, cursor),
      startAfter: (last) => query(limit, last.ref.path),
      get: async () => {
        effects.push('query');
        const paths = [...documents.keys()].filter((path) => path.split('/').at(-2) === 'tokens' && (!cursor || path > cursor)).sort().slice(0, limit);
        return { docs: paths.map((path) => snapshot(ref(path))) };
      },
    };
  }
  return {
    documents, effects,
    doc: ref,
    collectionGroup: (name) => { assert.equal(name, 'tokens'); return query(); },
    getAll: async (...refs) => {
      effects.push(...refs.map((documentRef) => `get:${documentRef.path}`));
      return refs.map(snapshot);
    },
    runTransaction: async (callback) => {
      const previous = transactionTail;
      let release;
      transactionTail = new Promise((resolve) => { release = resolve; });
      await previous;
      try {
        const writes = [];
        const transaction = {
          get: async (documentRef) => {
            effects.push(`get:${documentRef.path}`);
            return snapshot(documentRef);
          },
          set: (documentRef, data, options) => writes.push({ kind: 'set', documentRef, data, options }),
          delete: (documentRef) => writes.push({ kind: 'delete', documentRef }),
        };
        const result = await callback(transaction);
        for (const write of writes) {
          effects.push(`${write.kind}:${write.documentRef.path}`);
          if (write.kind === 'delete') documents.delete(write.documentRef.path);
          else documents.set(write.documentRef.path, structuredClone(write.options?.merge
            ? { ...documents.get(write.documentRef.path), ...write.data }
            : write.data));
        }
        return result;
      } finally { release(); }
    },
  };
}

function fixture({ users = {}, identity = { uid: 'administrator', admin: true }, initial = {}, send, now = () => CLOCK } = {}) {
  const docs = {
    'announcements/news': { title: 'Nouvelle vidéo', body: 'Une nouvelle leçon est disponible.', createdBy: 'administrator' },
    ...initial,
  };
  for (const [uid, status] of Object.entries(users)) {
    const token = tokenFor(uid);
    docs[`entitlements/${uid}`] = { status };
    docs[`pushTokens/${uid}/tokens/${hash(token)}`] = { token };
  }
  const db = fakeFirestore(docs);
  const authCalls = [];
  const deliveries = [];
  let initializationCount = 0;
  const services = {
    db,
    documentId: '__name__',
    serverTimestamp: () => new Date(now()),
    auth: {
      verifyIdToken: async (...args) => {
        authCalls.push(args);
        if (identity instanceof Error) throw identity;
        return identity;
      },
    },
    messaging: {
      sendEachForMulticast: async (message) => {
        deliveries.push(message);
        return send ? send(message, deliveries.length) : { responses: message.tokens.map(() => ({ success: true })) };
      },
    },
  };
  const handler = createPushHandler({
    getServices: async () => { initializationCount += 1; return services; },
    now,
    uuid: () => `lease-${initializationCount}`,
    appOrigin: 'https://drissart.com',
  });
  return { handler, services, db, authCalls, deliveries, get initializationCount() { return initializationCount; } };
}

async function invoke(handler, { method = 'POST', body = { announcementId: 'news' }, authorization = 'Bearer signed-id-token' } = {}) {
  const response = {
    headers: {}, statusCode: 0, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
  await handler({ method, body, headers: authorization === null ? {} : { authorization } }, response);
  return response;
}

test('GET and unsigned requests cannot initialize Firebase or touch data', async () => {
  const app = fixture();
  const get = await invoke(app.handler, { method: 'GET' });
  assert.equal(get.statusCode, 405);
  assert.equal(get.headers.Allow, 'POST');
  assert.equal(get.headers['Cache-Control'], 'no-store');
  const unsigned = await invoke(app.handler, { authorization: null });
  assert.equal(unsigned.statusCode, 401);
  assert.equal(app.initializationCount, 0);
  assert.deepEqual(app.db.effects, []);
});

test('a valid ordinary user is rejected before any Firestore read or write', async () => {
  const app = fixture({ identity: { uid: 'member', admin: false }, users: { member: 'active' } });
  const result = await invoke(app.handler);
  assert.equal(result.statusCode, 403);
  assert.deepEqual(app.authCalls, [['signed-id-token', true]]);
  assert.deepEqual(app.db.effects, []);
  assert.deepEqual(app.deliveries, []);
});

test('expired/revoked authentication cannot expose SDK exceptions or touch data', async () => {
  const secret = 'sensitive-oauth-token-never-return';
  const app = fixture({ identity: new Error(secret) });
  const result = await invoke(app.handler);
  assert.equal(result.statusCode, 401);
  assert.deepEqual(result.body, { error: 'invalid_authentication' });
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.deepEqual(app.db.effects, []);
});

test('invalid IDs, unexpected fields and invalid JSON have no effects', async () => {
  const app = fixture();
  for (const body of [
    { announcementId: '../private' }, { announcementId: '' },
    { announcementId: 'news', title: 'Forged content' },
    { announcementId: 'news', admin: true }, ['news'], '{broken',
  ]) {
    const result = await invoke(app.handler, { body });
    assert.equal(result.statusCode, 400);
  }
  assert.equal(app.initializationCount, 0);
  assert.deepEqual(app.db.effects, []);
});

test('missing production credentials return a safe service error', async () => {
  const handler = createPushHandler({ getServices: async () => { throw new Error('private_key=do-not-expose'); } });
  const result = await invoke(handler);
  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.body, { error: 'push_unavailable' });
});

test('unknown announcements return 404 without sending or creating data', async () => {
  const app = fixture({ users: { member: 'active' } });
  const result = await invoke(app.handler, { body: { announcementId: 'missing' } });
  assert.equal(result.statusCode, 404);
  assert.equal(app.db.documents.has('announcements/missing'), false);
  assert.equal(app.deliveries.length, 0);
  assert.ok(app.db.effects.every((effect) => effect.startsWith('get:')));
});

test('only currently active members receive trusted announcement content', async () => {
  const orphanToken = tokenFor('orphan');
  const forgedToken = tokenFor('forged');
  const app = fixture({
    users: { active: 'active', pending: 'pending', suspended: 'suspended', forged: 'active' },
    initial: {
      [`pushTokens/orphan/tokens/${hash(orphanToken)}`]: { token: orphanToken },
      ['pushTokens/forged/tokens/incorrect-document-hash']: { token: forgedToken },
    },
  });
  // Keep only the forged document for that user, to demonstrate hash checking.
  app.db.documents.delete(`pushTokens/forged/tokens/${hash(forgedToken)}`);
  const result = await invoke(app.handler);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { sent: 1, failed: 0, alreadySent: false, status: 'sent', retryable: false });
  assert.deepEqual(app.deliveries[0].tokens, [tokenFor('active')]);
  assert.deepEqual(app.deliveries[0].notification, { title: 'Nouvelle vidéo', body: 'Une nouvelle leçon est disponible.' });
  assert.deepEqual(app.deliveries[0].data, { announcementId: 'news', path: '/dashboard' });
  assert.equal(app.deliveries[0].webpush.fcmOptions.link, 'https://drissart.com/dashboard?announcement=news');
  assert.ok(!JSON.stringify(result).includes(tokenFor('active')));
});

test('no active recipients completes with zero accepted sends', async () => {
  const app = fixture({ users: { pending: 'pending', suspended: 'suspended' } });
  const result = await invoke(app.handler);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.sent, 0);
  assert.equal(app.deliveries.length, 0);
  assert.equal(app.db.documents.get('announcements/news').pushStatus, 'sent');
});

test('completed announcements are idempotent and do not re-query recipients', async () => {
  const app = fixture({ users: { member: 'active' } });
  await invoke(app.handler);
  const effectsBefore = app.db.effects.length;
  const result = await invoke(app.handler);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.alreadySent, true);
  assert.equal(result.body.sent, 1);
  assert.equal(app.deliveries.length, 1);
  assert.deepEqual(app.db.effects.slice(effectsBefore), ['get:announcements/news']);
});

test('simultaneous requests cannot claim the same announcement', async () => {
  let releaseSend;
  let startedSend;
  const sendStarted = new Promise((resolve) => { startedSend = resolve; });
  const app = fixture({ users: { member: 'active' }, send: async (message) => {
    startedSend();
    await new Promise((resolve) => { releaseSend = resolve; });
    return { responses: message.tokens.map(() => ({ success: true })) };
  } });
  const first = invoke(app.handler);
  await sendStarted;
  const duplicate = await invoke(app.handler);
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.body.error, 'push_in_progress');
  releaseSend();
  assert.equal((await first).statusCode, 200);
  assert.equal(app.deliveries.length, 1);
});

test('permanently invalid registrations are deleted; successful sends are retained', async () => {
  const app = fixture({ users: { good: 'active', invalid: 'active' }, send: async (message) => ({
    responses: message.tokens.map((token) => token === tokenFor('invalid')
      ? { success: false, error: { code: 'messaging/registration-token-not-registered' } }
      : { success: true }),
  }) });
  const result = await invoke(app.handler);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.sent, 1);
  assert.equal(result.body.failed, 1);
  assert.equal(app.db.documents.has(`pushTokens/invalid/tokens/${hash(tokenFor('invalid'))}`), false);
  assert.equal(app.db.documents.has(`pushTokens/good/tokens/${hash(tokenFor('good'))}`), true);
  assert.equal(app.db.documents.get(`announcements/news/pushReceipts/${hash(tokenFor('invalid'))}`).status, 'invalid');
});

test('transient failures remain retryable without resending prior successes', async () => {
  const app = fixture({ users: { good: 'active', retry: 'active' }, send: async (message, attempt) => ({
    responses: message.tokens.map((token) => attempt === 1 && token === tokenFor('retry')
      ? { success: false, error: { code: 'messaging/server-unavailable', message: 'secret internal context' } }
      : { success: true }),
  }) });
  const first = await invoke(app.handler);
  assert.equal(first.statusCode, 202);
  assert.deepEqual(first.body, { sent: 1, failed: 1, alreadySent: false, status: 'partial', retryable: true });
  assert.equal(app.db.documents.has(`pushTokens/retry/tokens/${hash(tokenFor('retry'))}`), true);
  const second = await invoke(app.handler);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.sent, 2);
  assert.equal(second.body.failed, 0);
  assert.deepEqual(app.deliveries[1].tokens, [tokenFor('retry')]);
  assert.ok(!JSON.stringify(first).includes('secret internal context'));
});

test('a provider outage releases the lease and allows a later retry', async () => {
  const app = fixture({ users: { member: 'active' }, send: async (message, attempt) => {
    if (attempt === 1) throw new Error('Authorization: secret-provider-key');
    return { responses: message.tokens.map(() => ({ success: true })) };
  } });
  const first = await invoke(app.handler);
  assert.equal(first.statusCode, 503);
  assert.equal(first.body.retryable, true);
  assert.equal(app.db.documents.get('announcements/news').pushStatus, 'failed');
  assert.ok(!JSON.stringify(first).includes('secret-provider-key'));
  const second = await invoke(app.handler);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.sent, 1);
});

test('stale sends may recover, but exhausted attempts cannot loop forever', async () => {
  const stale = fixture({ users: { member: 'active' }, initial: {
    'announcements/news': {
      title: 'Recover', body: 'Content', pushStatus: 'sending', pushAttempts: 1,
      pushStartedAt: new Date(CLOCK - 120001), pushUpdatedAt: new Date(CLOCK - 120001),
    },
  } });
  assert.equal((await invoke(stale.handler)).statusCode, 200);
  assert.equal(stale.db.documents.get('announcements/news').pushAttempts, 2);
  const exhausted = fixture({ initial: {
    'announcements/news': {
      title: 'Recover', body: 'Content', pushStatus: 'sending', pushAttempts: 5,
      pushStartedAt: new Date(CLOCK - 120001),
    },
  } });
  const result = await invoke(exhausted.handler);
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.error, 'push_retry_limit_reached');
  assert.equal(exhausted.deliveries.length, 0);
});

test('per-token receipts survive a process restart and prevent a recovered lease resending', async () => {
  const app = fixture({ users: { first: 'active', second: 'active' }, initial: {
    'announcements/news': {
      title: 'Recover', body: 'Content', pushStatus: 'sending', pushAttempts: 1,
      pushStartedAt: new Date(CLOCK - 120001), pushSummary: { sent: 1, invalid: 0, failed: 0 },
    },
    [`announcements/news/pushReceipts/${hash(tokenFor('first'))}`]: { status: 'sent', processedAt: new Date(CLOCK - 120001) },
  } });
  const result = await invoke(app.handler);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.sent, 2);
  assert.deepEqual(app.deliveries[0].tokens, [tokenFor('second')]);
});

test('more than 500 recipients are paginated into supported FCM batches', async () => {
  const users = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`member-${index}`, 'active']));
  const app = fixture({ users });
  const result = await invoke(app.handler);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.sent, 501);
  assert.deepEqual(app.deliveries.map((message) => message.tokens.length), [500, 1]);
  assert.equal(new Set(app.deliveries.flatMap((message) => message.tokens)).size, 501);
});

test('unsafe notification origins and oversized announcement content cannot send', async () => {
  const app = fixture({ users: { member: 'active' } });
  const handler = createPushHandler({ getServices: async () => app.services, appOrigin: 'https://example.com@evil.test/path' });
  assert.equal((await invoke(handler)).statusCode, 503);
  assert.deepEqual(app.db.effects, []);
  app.db.documents.set('announcements/news', { title: 'x'.repeat(121), body: 'Content' });
  assert.equal((await invoke(app.handler)).statusCode, 422);
  assert.equal(app.deliveries.length, 0);
  assert.equal(app.db.documents.get('announcements/news').pushStatus, undefined);
});
