#!/usr/bin/env node
import { createRequire } from 'node:module';
import { applicationDefault, initializeApp, refreshToken } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const args = process.argv.slice(2);
const uidIndex = args.indexOf('--uid');
const uid = uidIndex >= 0 ? args[uidIndex + 1] : undefined;
const projectIndex = args.indexOf('--project');
const projectId = projectIndex >= 0 ? args[projectIndex + 1] : process.env.FIREBASE_PROJECT_ID;
const remove = args.includes('--remove');
const knownArguments = new Set(['--uid', '--project', '--remove']);

if (!uid || uid.startsWith('--') || uid.includes('/') || uid.length > 128
  || (projectId && !/^[a-z][a-z0-9-]{4,62}$/.test(projectId))
  || (projectIndex >= 0 && !projectId)
  || args.some((arg, index) => index !== uidIndex + 1 && !(projectIndex >= 0 && index === projectIndex + 1) && !knownArguments.has(arg))) {
  console.error('Usage: node scripts/set-admin.mjs --uid FIREBASE_USER_UID [--project FIREBASE_PROJECT_ID] [--remove]');
  process.exit(1);
}

// Execute only on a trusted operator machine using Application Default
// Credentials. Never bundle this script or a service account in the web app.
let credential = applicationDefault();
if (process.env.FIREBASE_TOKEN) {
  // Use the official Firebase CLI OAuth client metadata with the operator's
  // securely injected refresh token. No token is saved or printed here.
  const require = createRequire(import.meta.url);
  const api = require('firebase-tools/lib/api.js');
  credential = refreshToken({
    client_id: api.clientId(),
    client_secret: api.clientSecret(),
    refresh_token: process.env.FIREBASE_TOKEN,
    type: 'authorized_user',
  });
}
initializeApp({ credential, projectId });
const authentication = getAuth();

try {
  const user = await authentication.getUser(uid);
  const claims = { ...(user.customClaims ?? {}) };
  if (remove) delete claims.admin;
  else claims.admin = true;
  await authentication.setCustomUserClaims(uid, claims);
  if (remove) await authentication.revokeRefreshTokens(uid);
  console.log(remove
    ? 'Rôle administrateur supprimé. Les sessions existantes doivent renouveler leur jeton.'
    : 'Rôle administrateur accordé. Déconnectez puis reconnectez ce compte pour renouveler son jeton.');
} catch (error) {
  // Print only an error code, never credential details or token contents.
  console.error(`Impossible de modifier le rôle administrateur (${error.code ?? 'unknown'}).`);
  process.exitCode = 1;
}
