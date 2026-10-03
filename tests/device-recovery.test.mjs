import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createDeviceRecovery} from '../src/device-recovery.mjs';
import {makeBank} from '../src/curriculum.mjs';

const secret='ab'.repeat(32),otherSecret='cd'.repeat(32);
const sample=(id='result-1')=>{const q=makeBank('en-IN',1,'A')[0];return {id,learner:'learner-a',lang:'en-IN',level:1,mode:'diagnostic',form:'A',at:'2026-09-12T12:00:00Z',responses:[{item:q.id,domain:q.domain,score:2,answer:2,supported:false,response:'Independent',note:'Private learner observation हिन्दी'}]}};
function fixture(){
  const map=new Map();let queue=Promise.resolve(),blocked=false;
  const storage={get length(){return map.size},key:i=>[...map.keys()][i]??null,getItem:k=>map.get(k)??null,setItem(k,v){if(blocked)throw Error('Storage quota exceeded');map.set(k,v)},removeItem(k){if(blocked)throw Error('Storage blocked');map.delete(k)}};
  const lock=(task,onFailure)=>{queue=queue.then(task,task);queue.catch(onFailure);return queue};
  return {map,storage,lock,block(value=true){blocked=value},device(userId='adult-a',keyProvider=()=>secret){return createDeviceRecovery({storage,lock,crypto:webcrypto,userId,keyProvider})}};
}
test('device recovery is opt-in and never persists the account key or plaintext evidence',async()=>{
  const f=fixture();let requests=0;const d=f.device('adult-a',()=>{requests++;return secret});
  assert.equal(d.enabled(),false);assert.equal(await d.save('class',sample()),false);assert.equal(requests,0);assert.equal(f.map.size,0);
  await d.enable(true);await d.save('class',sample());assert.equal(requests,1);assert.equal(d.count(),1);
  const stored=JSON.stringify([...f.map]);assert.ok(!stored.includes(secret));assert.ok(!stored.includes('Private learner observation'));assert.ok(!stored.includes('Independent'));assert.ok(!stored.includes('learner-a'));
  assert.deepEqual((await d.load('class')).sessions,[sample()]);
});
test('encrypted recovery survives a new instance and requires the correct adult key',async()=>{
  const f=fixture(),first=f.device();await first.enable(true);await first.save('class',sample());first.forgetKey();
  assert.deepEqual((await f.device().load('class')).sessions,[sample()]);
  assert.equal((await f.device('adult-b',()=>otherSecret).load('class')).sessions.length,0);
  const wrong=await f.device('adult-a',()=>otherSecret).load('class');assert.equal(wrong.sessions.length,0);assert.equal(wrong.unreadable,1);assert.equal(f.device().count(),1);
});
test('authenticated encryption detects changed ciphertext and moved workspace or account entries',async()=>{
  const f=fixture(),d=f.device();await d.enable(true);await d.save('class',sample());
  const [key,raw]=[...f.map].find(([k])=>k.includes(':result:'));const entry=JSON.parse(raw);
  entry.ciphertext=(entry.ciphertext[0]==='A'?'B':'A')+entry.ciphertext.slice(1);f.map.set(key,JSON.stringify(entry));
  assert.equal((await d.load('class')).unreadable,1);f.map.set(key,raw);
  f.map.set(key.replace(':class:',':other:'),raw);assert.equal((await d.load('other')).unreadable,1);
  f.map.set(key.replace('adult-a','adult-b'),raw);assert.equal((await f.device('adult-b').load('class')).unreadable,1);
  assert.deepEqual((await d.load('class')).sessions,[sample()]);
});
test('concurrent same-ID saves are idempotent and conflicting evidence cannot overwrite a device copy',async()=>{
  const f=fixture(),a=f.device(),b=f.device();await a.enable(true);
  const r=await Promise.all([a.save('class',sample()),b.save('class',sample())]);assert.deepEqual(r,[true,true]);assert.equal(a.count(),1);
  await assert.rejects(b.save('class',{...sample(),at:'2026-09-13T12:00:00Z'}),/different device copy/);assert.deepEqual((await a.load('class')).sessions,[sample()]);
});
test('device limits are enforced across concurrent tabs without deleting older copies',async()=>{
  const f=fixture(),a=f.device(),b=f.device();await a.enable(true);
  for(let i=0;i<9;i++)await a.save('class',sample('old-'+i));
  const results=await Promise.allSettled([a.save('class',sample('last-a')),b.save('class',sample('last-b'))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(a.count('class'),10);
  for(let i=0;i<10;i++)await a.save('other',sample('other-'+i));
  await assert.rejects(a.save('third',sample('overflow')),/full/);assert.equal(a.count(),20);
});
test('blocked storage preserves existing copies and never reports a new durable device save',async()=>{
  const f=fixture(),d=f.device();await d.enable(true);await d.save('class',sample());f.block();
  await assert.rejects(d.save('class',sample('new')),/quota/);assert.equal(d.count(),1);
  await assert.rejects(d.remove('class','result-1'),/blocked/);assert.deepEqual((await d.load('class')).sessions,[sample()]);
});
test('disabling requires pending copies to be resolved; clearing affects only the current adult',async()=>{
  const f=fixture(),a=f.device(),b=f.device('adult-b',()=>otherSecret);await a.enable(true);await b.enable(true);await a.save('class',sample());await b.save('class',sample());
  await assert.rejects(a.enable(false),/Save or clear/);assert.equal(a.enabled(),true);
  await a.clear();assert.equal(a.enabled(),false);assert.equal(a.count(),0);assert.equal(b.count(),1);assert.deepEqual((await b.load('class')).sessions,[sample()]);
});
test('unavailable keys and malformed copies are retained for retry without a plaintext fallback',async()=>{
  const f=fixture(),a=f.device();await a.enable(true);await a.save('class',sample());
  let offline=true;const d=f.device('adult-a',()=>{if(offline)throw Error('Offline');return secret});await assert.rejects(d.load('class'),/Offline/);assert.equal(d.count(),1);
  offline=false;assert.deepEqual((await d.load('class')).sessions,[sample()]);
  const key=[...f.map.keys()].find(k=>k.includes(':result:'));f.map.set(key,'{broken');assert.equal((await d.load('class')).unreadable,1);assert.equal(d.count(),1);
});
