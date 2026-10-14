/**
 * Single-use, fail-closed deployment of XAUUSD VIP signal Firestore rules.
 * Mutates only /releases/cloud.firestore of vipxauusd-f0693, and only if the
 * deployed source exactly matches the verified pre-signals rules snapshot.
 * Secrets and source are never logged. Remove this from build after success.
 */
import { readFile } from 'node:fs/promises';
import { cert } from 'firebase-admin/app';

const projectId = 'vipxauusd-f0693';
const credentialJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const normalize = s => s.replace(/\r\n/g, '\n').trim();
if (!credentialJson) {
  console.log('SIGNAL_RULES_UPGRADE=SKIPPED_LOCAL_BUILD');
} else {
  const account = JSON.parse(credentialJson);
  if (!account || account.type !== 'service_account' || account.project_id !== projectId) {
    throw Error('SIGNAL_RULES_UPGRADE=INVALID_PROJECT');
  }
  const token = (await cert(account).getAccessToken()).access_token;
  const endpoint = 'https://firebaserules.googleapis.com/v1/projects/' + projectId;
  const call = async (path, method = 'GET', payload) => {
    const res = await fetch('https://firebaserules.googleapis.com/v1/' + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw Error('SIGNAL_RULES_UPGRADE=RULES_API_HTTP_' + res.status);
    return res.json();
  };
  const oldSource = normalize(await readFile(new URL('../firestore.rules.before-signals', import.meta.url), 'utf8'));
  const newSource = normalize(await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'));
  const releasePath = 'projects/' + projectId + '/releases/cloud.firestore';
  const release = await call(releasePath);
  if (release.name !== releasePath || !/^projects\/vipxauusd-f0693\/rulesets\/[A-Za-z0-9_-]+$/.test(release.rulesetName || '')) {
    throw Error('SIGNAL_RULES_UPGRADE=BAD_RELEASE');
  }
  const getActive = async (name) => {
    const set = await call(name);
    if (!Array.isArray(set.source?.files) || set.source.files.length !== 1) throw Error('SIGNAL_RULES_UPGRADE=UNEXPECTED_SOURCE');
    return normalize(set.source.files[0].content);
  };
  const live = await getActive(release.rulesetName);
  if (live === newSource) {
    console.log('SIGNAL_RULES_UPGRADE=ALREADY_CURRENT');
  } else if (live !== oldSource) {
    throw Error('SIGNAL_RULES_UPGRADE=SAFETY_ABORT_DIFFERENT_RULES');
  } else {
    const created = await call('projects/' + projectId + '/rulesets', 'POST', {
      source: { files: [{ name: 'firestore.rules', content: newSource + '\n' }] },
    });
    if (!/^projects\/vipxauusd-f0693\/rulesets\/[A-Za-z0-9_-]+$/.test(created.name || '')) {
      throw Error('SIGNAL_RULES_UPGRADE=BAD_RULESET');
    }
    const latest = await call(releasePath);
    if (latest.rulesetName !== release.rulesetName) throw Error('SIGNAL_RULES_UPGRADE=CONCURRENT_UPDATE');
    const updated = await call(releasePath, 'PATCH', {
      release: { name: releasePath, rulesetName: created.name },
      updateMask: 'rulesetName',
    });
    if (updated.rulesetName !== created.name) throw Error('SIGNAL_RULES_UPGRADE=RELEASE_NOT_UPDATED');
    const verifiedRelease = await call(releasePath);
    const verified = await getActive(verifiedRelease.rulesetName);
    if (verified !== newSource) throw Error('SIGNAL_RULES_UPGRADE=VERIFICATION_FAILED');
    console.log('SIGNAL_RULES_UPGRADE=DEPLOYED_AND_VERIFIED');
  }
}
