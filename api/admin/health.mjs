import { getFirebaseServices } from '../lib/firebase-admin.mjs';

/** Minimal readiness probe: returns no private configuration or user data. */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  try {
    const services = await getFirebaseServices();
    if (!services.auth || !services.db || !services.messaging) throw new Error('missing_services');
    return res.status(200).json({ ready: true });
  } catch (error) {
    // Temporary diagnostic: phase is a fixed server-side enum, never a secret.
    const allowedPhases = new Set(['sdk_imports', 'credential_validation', 'credential_access_token', 'admin_app_initialization', 'admin_service_initialization', 'configuration_unavailable']);
    const phase = error?.name === 'FirebaseConfigurationError' && allowedPhases.has(error.phase) ? error.phase : 'unavailable';
    return res.status(503).json({ ready: false, phase });
  }
}
