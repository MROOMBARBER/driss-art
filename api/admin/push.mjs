import { createHash, randomUUID } from 'node:crypto';
import { getFirebaseServices } from '../lib/firebase-admin.mjs';

const PAGE_SIZE = 500;
const RECEIPT_TRANSACTION_SIZE = 200;
const LEASE_MS = 120000;
const MAX_ATTEMPTS = 5;
const MAX_RUNTIME_MS = 40000;
const PERMANENT_TOKEN_ERRORS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

class RequestError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function respond(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

function asMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return typeof value === 'number' ? value : 0;
}

function summaryOf(data) {
  const summary = data.pushSummary || {};
  const count = (key) => Number.isSafeInteger(summary[key]) && summary[key] >= 0 ? summary[key] : 0;
  return { sent: count('sent'), failed: count('failed'), invalid: count('invalid') };
}

function parseRequest(req, idField = 'announcementId') {
  let body = req.body;
  if (typeof body === 'string') {
    if (body.length > 1024) throw new RequestError(400, 'invalid_request');
    try { body = JSON.parse(body); } catch { throw new RequestError(400, 'invalid_request'); }
  }
  if (
    !body || typeof body !== 'object' || Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    typeof body[idField] !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(body[idField])
  ) throw new RequestError(400, 'invalid_request');
  return body[idField];
}

function safeOrigin(value) {
  try {
    const url = new URL(value || 'https://drissart.com');
    if (
      url.protocol !== 'https:' || url.username || url.password ||
      url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')
    ) throw new Error();
    return url.origin;
  } catch {
    throw new RequestError(503, 'push_configuration_unavailable');
  }
}

function validateAnnouncement(data) {
  if (
    typeof data.title !== 'string' || !data.title.trim() || data.title.length > 120 ||
    typeof data.body !== 'string' || !data.body.trim() || data.body.length > 1500
  ) throw new RequestError(422, 'invalid_announcement');
}

async function claimAnnouncement(services, ref, leaseId, now) {
  return services.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new RequestError(404, 'announcement_not_found');
    const data = snapshot.data();
    validateAnnouncement(data);
    if (data.pushStatus === 'sent') return { alreadySent: true, data };
    if (
      data.pushStatus === 'sending' &&
      now - asMillis(data.pushUpdatedAt || data.pushStartedAt) < LEASE_MS
    ) throw new RequestError(409, 'push_in_progress');
    const attempts = Number.isSafeInteger(data.pushAttempts) ? data.pushAttempts : 0;
    if (attempts >= MAX_ATTEMPTS) throw new RequestError(409, 'push_retry_limit_reached');
    const summary = summaryOf(data);
    transaction.set(ref, {
      pushStatus: 'sending',
      pushLeaseId: leaseId,
      pushAttempts: attempts + 1,
      pushStartedAt: services.serverTimestamp(),
      pushUpdatedAt: services.serverTimestamp(),
      pushLastError: null,
      pushSummary: { ...summary, pending: 0, retryable: false },
    }, { merge: true });
    return { alreadySent: false, data };
  });
}

async function getSnapshots(db, refs) {
  const snapshots = [];
  for (let offset = 0; offset < refs.length; offset += PAGE_SIZE) {
    snapshots.push(...await db.getAll(...refs.slice(offset, offset + PAGE_SIZE)));
  }
  return snapshots;
}

async function recipientsForPage(services, announcementRef, docs) {
  const candidates = [];
  const seen = new Set();
  for (const doc of docs) {
    const parts = doc.ref.path.split('/');
    if (parts.length !== 4 || parts[0] !== 'pushTokens' || parts[2] !== 'tokens') continue;
    const token = doc.data().token;
    if (typeof token !== 'string' || token.length < 20 || token.length > 8192) continue;
    const hash = createHash('sha256').update(token).digest('hex');
    if (hash !== parts[3] || seen.has(hash)) continue;
    seen.add(hash);
    candidates.push({ token, hash, uid: parts[1], ref: doc.ref });
  }
  if (!candidates.length) return [];
  const uids = [...new Set(candidates.map((candidate) => candidate.uid))];
  const entitlements = await getSnapshots(services.db, uids.map((uid) => services.db.doc(`entitlements/${uid}`)));
  const active = new Set(entitlements.filter((snapshot) => snapshot.exists && snapshot.data().status === 'active').map((snapshot) => snapshot.id));
  const activeCandidates = candidates.filter((candidate) => active.has(candidate.uid));
  if (!activeCandidates.length) return [];
  const receipts = await getSnapshots(services.db, activeCandidates.map((candidate) => announcementRef.collection('pushReceipts').doc(candidate.hash)));
  return activeCandidates.filter((candidate, index) => !receipts[index].exists);
}

/** A receipt and the aggregate count commit together, including after a process restart. */
async function recordResults(services, announcementRef, leaseId, recipients, responses) {
  const terminalResults = [];
  let transientFailures = 0;
  for (let index = 0; index < recipients.length; index += 1) {
    const response = responses[index];
    if (response?.success) terminalResults.push({ recipient: recipients[index], status: 'sent' });
    else if (PERMANENT_TOKEN_ERRORS.has(response?.error?.code)) {
      terminalResults.push({ recipient: recipients[index], status: 'invalid' });
    } else transientFailures += 1;
  }

  for (let offset = 0; offset < terminalResults.length; offset += RECEIPT_TRANSACTION_SIZE) {
    const chunk = terminalResults.slice(offset, offset + RECEIPT_TRANSACTION_SIZE);
    await services.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(announcementRef);
      const data = snapshot.data();
      if (data.pushLeaseId !== leaseId || data.pushStatus !== 'sending') {
        throw new RequestError(409, 'push_lease_lost');
      }
      const summary = summaryOf(data);
      for (const result of chunk) {
        transaction.set(announcementRef.collection('pushReceipts').doc(result.recipient.hash), {
          status: result.status,
          processedAt: services.serverTimestamp(),
        });
        if (result.status === 'sent') summary.sent += 1;
        else {
          summary.invalid += 1;
          transaction.delete(result.recipient.ref);
        }
      }
      transaction.set(announcementRef, {
        pushSummary: { ...summary, failed: summary.invalid },
        pushUpdatedAt: services.serverTimestamp(),
      }, { merge: true });
    });
  }
  return transientFailures;
}

async function finish(services, ref, leaseId, { transientFailures, incomplete, errorCode }) {
  return services.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    if (data.pushLeaseId !== leaseId || data.pushStatus !== 'sending') {
      throw new RequestError(409, 'push_lease_lost');
    }
    const summary = summaryOf(data);
    const retryable = transientFailures > 0 || incomplete || Boolean(errorCode);
    const status = errorCode ? 'failed' : retryable ? 'partial' : 'sent';
    const finalSummary = {
      ...summary,
      failed: summary.invalid + transientFailures,
      pending: transientFailures + (incomplete ? 1 : 0),
      retryable,
    };
    transaction.set(ref, {
      pushStatus: status,
      pushSummary: finalSummary,
      pushUpdatedAt: services.serverTimestamp(),
      pushLastError: errorCode || null,
      ...(status === 'sent' ? { pushSentAt: services.serverTimestamp() } : {}),
    }, { merge: true });
    return { sent: finalSummary.sent, failed: finalSummary.failed, alreadySent: false, status, retryable };
  });
}

/** Injection is only for isolated tests; the deployed handler always uses real Admin SDK services. */
export function createPushHandler({ getServices = getFirebaseServices, now = Date.now, uuid = randomUUID, appOrigin,
  collectionName = 'announcements', idField = 'announcementId', notificationQuery = 'announcement' } = {}) {
  return async function pushHandler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return respond(res, 405, { error: 'method_not_allowed' });
    }
    const authorization = req.headers?.authorization;
    if (typeof authorization !== 'string' || !/^Bearer [^\s]{1,8192}$/.test(authorization)) {
      return respond(res, 401, { error: 'authentication_required' });
    }

    let services;
    let announcementRef;
    let leaseId;
    let leaseClaimed = false;
    let transientFailures = 0;
    try {
      const announcementId = parseRequest(req, idField);
      services = await getServices();
      let identity;
      try {
        // Revoked or disabled users cannot use an old administrator token.
        identity = await services.auth.verifyIdToken(authorization.slice(7), true);
      } catch {
        throw new RequestError(401, 'invalid_authentication');
      }
      if (identity.admin !== true) throw new RequestError(403, 'administrator_required');
      const origin = safeOrigin(appOrigin ?? process.env.APP_ORIGIN);
      announcementRef = services.db.doc(`${collectionName}/${announcementId}`);
      leaseId = uuid();
      const startedAt = now();
      const claim = await claimAnnouncement(services, announcementRef, leaseId, startedAt);
      if (claim.alreadySent) {
        const summary = summaryOf(claim.data);
        return respond(res, 200, { sent: summary.sent, failed: summary.failed, alreadySent: true, status: 'sent', retryable: false });
      }
      leaseClaimed = true;
      let cursor;
      let incomplete = false;
      while (true) {
        if (now() - startedAt >= MAX_RUNTIME_MS) { incomplete = true; break; }
        let query = services.db.collectionGroup('tokens').orderBy(services.documentId).limit(PAGE_SIZE);
        if (cursor) query = query.startAfter(cursor);
        const page = await query.get();
        if (!page.docs.length) break;
        const recipients = await recipientsForPage(services, announcementRef, page.docs);
        if (recipients.length) {
          const delivery = await services.messaging.sendEachForMulticast({
            tokens: recipients.map((recipient) => recipient.token),
            notification: { title: claim.data.title, body: claim.data.body },
            data: { [idField]: announcementId, path: '/dashboard' },
            webpush: {
              headers: { TTL: '86400', Urgency: 'normal' },
              fcmOptions: { link: `${origin}/dashboard?${notificationQuery}=${encodeURIComponent(announcementId)}` },
            },
          });
          if (!Array.isArray(delivery.responses) || delivery.responses.length !== recipients.length) {
            throw new Error('Invalid messaging response.');
          }
          transientFailures += await recordResults(services, announcementRef, leaseId, recipients, delivery.responses);
        }
        cursor = page.docs.at(-1);
        if (page.docs.length < PAGE_SIZE) break;
      }
      const result = await finish(services, announcementRef, leaseId, { transientFailures, incomplete });
      return respond(res, result.retryable ? 202 : 200, result);
    } catch (error) {
      if (leaseClaimed && services && announcementRef) {
        try {
          const result = await finish(services, announcementRef, leaseId, {
            transientFailures,
            incomplete: true,
            errorCode: error instanceof RequestError ? error.code : 'push_unavailable',
          });
          return respond(res, error instanceof RequestError ? error.status : 503, {
            ...result,
            error: error instanceof RequestError ? error.code : 'push_unavailable',
          });
        } catch {
          // Do not overwrite a newer lease, or expose any SDK exception details.
        }
      }
      return respond(res, error instanceof RequestError ? error.status : 503, {
        error: error instanceof RequestError ? error.code : 'push_unavailable',
      });
    }
  };
}

export default createPushHandler();
