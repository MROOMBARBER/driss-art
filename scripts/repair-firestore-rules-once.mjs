/**
 * Restricted one-time repair for DRISS XAUUSD's default Firebase rules.
 * An unchanged, secure checked-in Firestore rules source is the only payload.
 * Refuse to overwrite custom deployed rules to avoid disturbing existing data.
 * Retire this script from the build command as soon as repair is verified.
 */
import { readFile } from 'node:fs/promises';
import { cert } from 'firebase-admin/app';

const projectId = 'vipxauusd-f0693';
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!serviceAccount) {
  console.log('FIRESTORE_REPAIR=SKIPPED_NO_SERVER_CREDENTIAL');
} else {
  const safeError = (code) => console.log('FIRESTORE_REPAIR=' + code);
  try {
    const account = JSON.parse(serviceAccount);
    if (!account || account.type !== 'service_account' || account.project_id !== projectId) throw new Error('credential_project_mismatch');
    const bearer = (await cert(account).getAccessToken()).access_token;
    if (!bearer) throw new Error('oauth_unavailable');
    const prefix = 'https://firebaserules.googleapis.com/v1/projects/' + projectId;
    const call = async (url, method = 'GET', body) => {
      const response = await fetch(url, {
        method,
        headers: { Authorization: 'Bearer ' + bearer, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(response.status === 403 ? 'permission_denied' : 'http_' + response.status);
      return response.json();
    };
    const release = await call(prefix + '/releases/cloud.firestore');
    if (!release?.name || release.name !== 'projects/' + projectId + '/releases/cloud.firestore' ||
        !/^projects\/vipxauusd-f0693\/rulesets\/[A-Za-z0-9_-]+$/.test(release.rulesetName || '')) {
      throw new Error('unexpected_release');
    }
    const getRuleset = (name) => call('https://firebaserules.googleapis.com/v1/' + name);
    const active = await getRuleset(release.rulesetName);
    const files = active?.source?.files || [];
    if (files.length !== 1 || typeof files[0]?.content !== 'string') throw new Error('complex_rules_source');
    const desired = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
    const normalized = (text) => text.replace(/\r\n/g, '\n').trim();
    const current = normalized(files[0].content);
    if (current === normalized(desired)) {
      console.log('FIRESTORE_REPAIR=ALREADY_CORRECT');
    } else {
      const raw = current.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ');
      // Only replace the canonical Firebase initial locked/test-mode rules,
      // never any deployment containing custom match paths or permissions.
      const hasExactlyTwoMatches = (raw.match(/\bmatch\s+\//g) || []).length === 2;
      const hasOneAllow = (raw.match(/\ballow\b/g) || []).length === 1;
      const isDefaultPath = /match\s+\/\{document=\*\*\}\s*\{/.test(raw);
      const isDefaultRule = /allow\s+read\s*,\s*write\s*:\s*if\s+(?:false|request\.time\s*<\s*timestamp\.date\(\s*\d{4}\s*,\s*\d{1,2}\s*,\s*\d{1,2}\s*\))\s*;/.test(raw);
      if (!hasExactlyTwoMatches || !hasOneAllow || !isDefaultPath || !isDefaultRule) {
        console.log('FIRESTORE_REPAIR=SKIPPED_CUSTOM_EXISTING_RULES');
      } else {
        const newlyCreated = await call(prefix + '/rulesets', 'POST', {
          source: { files: [{ name: 'firestore.rules', content: desired }] },
        });
        const name = newlyCreated?.name;
        if (!/^projects\/vipxauusd-f0693\/rulesets\/[A-Za-z0-9_-]+$/.test(name || '')) throw new Error('ruleset_create_unexpected');
        const updated = await call(prefix + '/releases/cloud.firestore', 'PATCH', {
          release: { name: release.name, rulesetName: name },
          updateMask: 'rulesetName',
        });
        if (updated.rulesetName !== name) throw new Error('release_update_unexpected');
        const verifyRelease = await call(prefix + '/releases/cloud.firestore');
        const verifyRuleset = await getRuleset(verifyRelease.rulesetName);
        const verifyContent = (verifyRuleset.source?.files || []).find((f) => f.name === 'firestore.rules')?.content;
        if (normalized(verifyContent || '') !== normalized(desired)) throw new Error('verification_failed');
        console.log('FIRESTORE_REPAIR=DEPLOYED_AND_VERIFIED');
      }
    }
  } catch (error) {
    const known = new Set(['credential_project_mismatch', 'oauth_unavailable', 'permission_denied', 'unexpected_release',
      'complex_rules_source', 'ruleset_create_unexpected', 'release_update_unexpected', 'verification_failed',
      'http_400', 'http_401', 'http_403', 'http_404', 'http_409', 'http_429', 'http_500', 'http_503']);
    safeError(known.has(error?.message) ? error.message : 'unavailable');
  }
}
