/**
 * Read-only check of the Firestore rules RELEASE, not the local emulator rules.
 * Uses existing production Firebase service credential, never prints token,
 * account data or deployed source. Outputs coarse status in build logs only.
 */
import { readFile } from 'node:fs/promises';
import { cert } from 'firebase-admin/app';
const projectId = 'vipxauusd-f0693';
const json=process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (json) {
  try {
    const account=JSON.parse(json);
    if(account.type!=='service_account'||account.project_id!==projectId){
      throw new Error('credential_project_mismatch');
    }
    const bearer=(await cert(account).getAccessToken()).access_token;
    const get=async (url)=>{
      const r=await fetch(url,{headers:{Authorization:'Bearer '+bearer},signal:AbortSignal.timeout(12000)});
      if(r.status===404)throw new Error('not_found');
      if(r.status===403)throw new Error('no_rules_read_permission');
      if(!r.ok)throw new Error('api_unavailable');
      return r.json();
    };
    const prefix='https://firebaserules.googleapis.com/v1/projects/'+projectId;
    const release=await get(prefix+'/releases/cloud.firestore');
    if(!/^projects\/vipxauusd-f0693\/rulesets\/[A-Za-z0-9_-]+$/.test(release.rulesetName||''))throw new Error('invalid_ruleset');
    const ruleset=await get('https://firebaserules.googleapis.com/v1/'+release.rulesetName);
    const deployed=(ruleset.source?.files||[]).find(file=>file.name==='firestore.rules'||file.name==='firestore.rules.txt')?.content;
    if(typeof deployed!=='string')throw new Error('unknown_rules_source');
    const expected=await readFile(new URL('../firestore.rules',import.meta.url),'utf8');
    const normalize=(s)=>s.replace(/\r\n/g,'\n').trim();
    console.log('FIRESTORE_RULES_AUDIT='+ (normalize(deployed)===normalize(expected)?'MATCH':'DIFFERENT'));
  } catch(error) {
    const valid=new Set(['not_found','no_rules_read_permission','api_unavailable','invalid_ruleset','unknown_rules_source','credential_project_mismatch']);
    console.log('FIRESTORE_RULES_AUDIT='+ (valid.has(error?.message)?error.message:'unavailable'));
  }
} else {
  console.log('FIRESTORE_RULES_AUDIT=SKIPPED_NO_PRODUCTION_CREDENTIAL');
}
