import { getFirebaseServices } from '../lib/firebase-admin.mjs';

const FIREBASE_PROJECT = 'vipxauusd-f0693';

function reply(res, status, errorOrResult) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(errorOrResult);
}

/**
 * One-time, owner-specific Firebase custom-claim grant.
 * ADMIN_BOOTSTRAP_UID lives ONLY in Vercel server environment.
 * It is never accepted from HTTP input or public VITE_* configuration.
 * Security: verified AND non-revoked Firebase ID token, exact UID allowlist,
 * exact Firebase project, server-only Admin SDK credential.
 * After successful activation, remove ADMIN_BOOTSTRAP_UID from Vercel.
 */
export function createBootstrapHandler({
  getServices = getFirebaseServices,
  allowedUid = () => process.env.ADMIN_BOOTSTRAP_UID,
} = {}) {
  return async function bootstrapHandler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return reply(res, 405, { error: 'method_not_allowed' });
    }
    const uid = allowedUid();
    if (!uid || typeof uid !== 'string' || !/^[A-Za-z0-9_-]{10,128}$/.test(uid)) {
      return reply(res, 503, { error: 'setup_not_configured' });
    }
    const authHeader = req.headers?.authorization;
    if (typeof authHeader !== 'string' || !/^Bearer [^\s]{1,8192}$/.test(authHeader)) {
      return reply(res, 401, { error: 'authentication_required' });
    }

    let services;
    try {
      services = await getServices();
    } catch {
      return reply(res, 503, { error: 'firebase_server_unavailable' });
    }
    if (services.auth?.app?.options?.projectId !== FIREBASE_PROJECT) {
      return reply(res, 503, { error: 'incorrect_firebase_project' });
    }

    let identity;
    try {
      identity = await services.auth.verifyIdToken(authHeader.slice(7), true);
    } catch {
      return reply(res, 401, { error: 'invalid_authentication' });
    }
    if (!identity || identity.uid !== uid) {
      return reply(res, 403, { error: 'not_bootstrap_owner' });
    }
    try {
      const user = await services.auth.getUser(identity.uid);
      if (user.disabled) return reply(res, 403, { error: 'user_disabled' });
      const existingClaims = user.customClaims || {};
      if (existingClaims.admin !== true) {
        await services.auth.setCustomUserClaims(user.uid, { ...existingClaims, admin: true });
      }
      return reply(res, 200, { activated: true });
    } catch {
      return reply(res, 503, { error: 'admin_role_update_failed' });
    }
  };
}

export default createBootstrapHandler();
