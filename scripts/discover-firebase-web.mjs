/**
 * Production-only Firebase Web config discovery.
 * Uses Firebase Admin credential on the build server; writes only PUBLIC
 * Firebase Web SDK identifiers to an ignored local Vite env file.
 * No service account fields or OAuth tokens are copied into client assets.
 */
import { writeFile } from 'node:fs/promises';
import { cert } from 'firebase-admin/app';

const PROJECT_ID = 'vipxauusd-f0693';
const ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

function fail(code) {
  console.error('Firebase Web SDK configuration unavailable (' + code + ').');
  process.exitCode = 1;
}
function valid(value) {
  return typeof value === 'string' && value.length > 0 && !/[\r\n\u0000]/.test(value);
}
async function getJson(url, accessToken) {
  const response = await fetch(url, {
    headers: { Authorization: 'Bearer ' + accessToken },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('firebase_management_http_' + response.status);
  return response.json();
}

if (!ACCOUNT) {
  // Local and CI builds deliberately remain usable without server secrets.
  console.log('Firebase Web SDK discovery skipped (no production server credential).');
} else if (process.env.VITE_FIREBASE_API_KEY && process.env.VITE_FIREBASE_APP_ID) {
  console.log('Firebase Web SDK configuration already supplied by Vercel.');
} else {
  try {
    const account = JSON.parse(ACCOUNT);
    if (account.type !== 'service_account' || account.project_id !== PROJECT_ID ||
        typeof account.private_key !== 'string' || !account.private_key.startsWith('-----BEGIN PRIVATE KEY-----') || !valid(account.client_email)) {
      throw new Error('wrong_server_credential_project');
    }
    const credential = cert(account);
    const token = (await credential.getAccessToken()).access_token;
    if (!valid(token)) throw new Error('missing_access_token');

    const base = 'https://firebase.googleapis.com/v1beta1/';
    const listing = await getJson(base + 'projects/' + PROJECT_ID + '/webApps?pageSize=100', token);
    const apps = (listing.apps || []).filter(
      (app) => app && app.state !== 'DELETED' && typeof app.name === 'string' &&
        /^projects\/vipxauusd-f0693\/webApps\//.test(app.name),
    );
    if (apps.length !== 1) throw new Error(apps.length ? 'multiple_web_apps' : 'web_app_not_found');

    const config = await getJson(base + apps[0].name + '/config', token);
    if (config.projectId !== PROJECT_ID ||
        !valid(config.apiKey) || !valid(config.appId) ||
        !valid(config.messagingSenderId) ||
        !/^1:\d+:web:[A-Za-z0-9_-]+$/.test(config.appId)) {
      throw new Error('invalid_public_web_config');
    }

    const publicVars = {
      VITE_FIREBASE_API_KEY: config.apiKey,
      VITE_FIREBASE_APP_ID: config.appId,
      VITE_FIREBASE_MESSAGING_SENDER_ID: config.messagingSenderId,
    };
    // Vercel already provides projectId & authDomain; infer only if missing.
    if (!process.env.VITE_FIREBASE_PROJECT_ID) publicVars.VITE_FIREBASE_PROJECT_ID = PROJECT_ID;
    if (!process.env.VITE_FIREBASE_AUTH_DOMAIN) publicVars.VITE_FIREBASE_AUTH_DOMAIN = PROJECT_ID + '.firebaseapp.com';
    const contents = Object.entries(publicVars).map(([key, value]) => key + '=' + JSON.stringify(value)).join('\n') + '\n';
    await writeFile('.env.production.local', contents, { mode: 0o600, flag: 'wx' });
    console.log('Firebase Web SDK identifiers configured for production build.');
  } catch (error) {
    const code = error instanceof Error && /^(?:firebase_management_http_\d+|wrong_server_credential_project|missing_access_token|multiple_web_apps|web_app_not_found|invalid_public_web_config)$/.test(error.message)
      ? error.message : 'discovery_failed';
    fail(code);
  }
}
