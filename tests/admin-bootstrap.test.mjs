import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBootstrapHandler } from '../api/admin/bootstrap.mjs';

const ADMIN='eni8YQ9LZLdgG3rP47jPr2LU4gn2';
const PROJECT='vipxauusd-f0693';
function setup({ allowedUid=ADMIN, identity={uid:ADMIN}, project=PROJECT, customClaims={role:'staff'}, disabled=false, verifyError=null }={}) {
  let storedClaims=null, setCalls=0, verifyCalls=0;
  const auth={
    app:{options:{projectId:project}},
    async verifyIdToken(token,checkRevoked){verifyCalls++;assert.equal(token,'valid-token');assert.equal(checkRevoked,true);if(verifyError)throw verifyError;return identity;},
    async getUser(uid){assert.equal(uid,ADMIN);return {uid,disabled,customClaims};},
    async setCustomUserClaims(uid,claims){assert.equal(uid,ADMIN);storedClaims=claims;setCalls++;},
  };
  const handler=createBootstrapHandler({allowedUid:()=>allowedUid,getServices:async()=>({auth})});
  async function invoke({method='POST',headers={authorization:'Bearer valid-token'}}={}){
    const req={method,headers},res={
      headers:{},
      setHeader(key,value){this.headers[key]=value;},
      status(code){this.code=code;return this;},
      json(body){this.body=body;return this;},
    };
    await handler(req,res);return res;
  }
  return {invoke,info:()=>({storedClaims,setCalls,verifyCalls})};
}
test('grants admin claim to the single verified owner, preserving other claims',async()=>{
  const t=setup();const r=await t.invoke();
  assert.equal(r.code,200);assert.equal(r.body.activated,true);
  assert.deepEqual(t.info().storedClaims,{role:'staff',admin:true});
  assert.equal(t.info().verifyCalls,1);
});
test('refuses arbitrary methods',async()=>{const t=setup();const r=await t.invoke({method:'GET'});assert.equal(r.code,405);assert.equal(t.info().setCalls,0);});
test('refuses no server allowlist',async()=>{const t=setup({allowedUid:undefined});const r=await t.invoke();assert.equal(r.code,503);assert.equal(t.info().setCalls,0);});
test('refuses missing bearer token',async()=>{const t=setup();const r=await t.invoke({headers:{}});assert.equal(r.code,401);assert.equal(t.info().setCalls,0);});
test('refuses different authenticated user',async()=>{const t=setup({identity:{uid:'unrelated-user-1234'}});const r=await t.invoke();assert.equal(r.code,403);assert.equal(t.info().setCalls,0);});
test('refuses wrong Firebase project',async()=>{const t=setup({project:'unrelated-project'});const r=await t.invoke();assert.equal(r.code,503);assert.equal(t.info().setCalls,0);});
test('refuses revoked token',async()=>{const t=setup({verifyError:new Error('revoked')});const r=await t.invoke();assert.equal(r.code,401);assert.equal(t.info().setCalls,0);});
test('refuses disabled user',async()=>{const t=setup({disabled:true});const r=await t.invoke();assert.equal(r.code,403);assert.equal(t.info().setCalls,0);});
test('idempotent for already-admin account',async()=>{const t=setup({customClaims:{admin:true}});const r=await t.invoke();assert.equal(r.code,200);assert.equal(t.info().setCalls,0);});
