import test from 'node:test';
import assert from 'node:assert/strict';
import {localDatabase} from '../server/local-db.mjs';
import {handleApi} from '../server/api.mjs';
import {makeBank} from '../src/curriculum.mjs';
import {authenticatedUser,authLinks} from '../server/auth.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

const owner={id:'owner',email:'owner@example.test'},teacher={id:'teacher',email:'teacher@example.test'},parent={id:'parent',email:'parent@example.test'},stranger={id:'stranger',email:'stranger@example.test'};
function fixture(){
  const DB=localDatabase();
  const call=async(path,user=owner,method='GET',body,headers={})=>{
    const response=await handleApi(new Request('https://school.example/api'+path,{method,headers:{...(user?{'oai-authenticated-user-id':user.id,'oai-authenticated-user-email':user.email}:{}),...(body?{'Content-Type':'application/json',Origin:'https://school.example','X-Language-Studio':'1'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)}),{DB});
    return {status:response.status,body:await response.json(),headers:response.headers};
  };
  return {DB,call};
}
const expect=async(p,status=200)=>{const r=await p;assert.equal(r.status,status,JSON.stringify(r.body));return r.body};
async function setup(){const f=fixture();const {workspaceId:w}=await expect(f.call('/workspaces',owner,'POST',{name:'Classroom'}),201);return {...f,w,path:'/workspaces/'+w}}
const sample=(learner,id='session-1')=>{const q=makeBank('en-IN',1,'A')[0];return {id,learner,lang:'en-IN',level:1,mode:'diagnostic',form:'A',at:'2026-09-12T10:00:00.000Z',responses:[{item:q.id,domain:q.domain,score:2,supported:false,answer:q.kind==='choice'?q.answer:2,response:q.kind==='choice'?q.options[q.answer]:'Independent'}]}};
async function save(f,data,user=owner,revision,operationId=crypto.randomUUID()){
  if(revision===undefined)revision=(await expect(f.call(f.path+'/data',user))).revision;
  return f.call(f.path+'/changes',user,'POST',{revision,operationId,data});
}
async function seed(f){return expect(save(f,{version:2,learners:[{id:'a',code:'Reader A'},{id:'b',code:'Reader B'}],sessions:[sample('a'),sample('b','session-b')]}))}
async function invite(f,user,role='teacher',learnerIds=[]){const result=await expect(f.call(f.path+'/invitations',owner,'POST',{email:user.email,role,learnerIds}),201);const token=new URL(result.url).searchParams.get('invite');return {...result,token}}
async function join(f,user,role='teacher',ids=[]){const i=await invite(f,user,role,ids);await expect(f.call('/invitations/'+i.token,user,'POST',{}));return i}
const draft=()=>({id:'draft-1',learner:'a',lang:'en-IN',level:1,mode:'diagnostic',form:'A',index:0,answers:[],heard:[],chosen:null,supported:false,feedback:false,note:'',evidence:''});

test('anonymous requests cannot read or mutate records; sign-in preserves invitation',async()=>{
  const f=await setup();const me=await expect(f.call('/me?returnTo='+encodeURIComponent('/?invite=abc'),null));assert.equal(me.user,null);assert.match(me.signIn,/invite%3Dabc/);
  for(const [path,method,b] of [[f.path+'/data','GET'],[f.path+'/members','GET'],[f.path+'/changes','POST',{data:{}}],['/workspaces','POST',{name:'x'}]])await expect(f.call(path,null,method,b),401);
});
test('trusted identity requires both headers; return links reject external origins',()=>{
  assert.equal(authenticatedUser(new Request('https://x',{headers:{'oai-authenticated-user-id':'a'}})),null);
  assert.equal(authLinks('//evil.test').signIn,'/signin-with-chatgpt?return_to=%2F');
  assert.equal(authLinks('/callback').signIn,'/signin-with-chatgpt?return_to=%2F');
  const u=authenticatedUser(new Request('https://x',{headers:{'oai-authenticated-user-id':'a','oai-authenticated-user-email':'A@example.test','oai-authenticated-user-full-name':'%E0%A4%86','oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8'}}));assert.equal(u.name,'आ');assert.equal(u.email,'a@example.test');
});
test('independent workspaces isolate learner IDs, sessions, membership and exports',async()=>{
  const f=await setup();await seed(f);
  await expect(f.call(f.path+'/data',stranger),403);await expect(f.call(f.path+'/members',stranger),403);
  const {workspaceId}=await expect(f.call('/workspaces',stranger,'POST',{name:'Family'}),201);
  const other={...f,path:'/workspaces/'+workspaceId};await expect(save(other,{version:2,learners:[{id:'a',code:'Different A'}],sessions:[]},stranger));
  assert.equal((await expect(f.call(f.path+'/data'))).data.learners[0].code,'Reader A');
  const me=await expect(f.call('/me',stranger));assert.deepEqual(me.workspaces.map(w=>w.id),[workspaceId]);
});
test('CSRF, missing custom header, invalid JSON and oversized payloads are rejected',async()=>{
  const f=await setup();await expect(f.call('/workspaces',owner,'POST',{name:'bad'},{Origin:'https://evil.test'}),403);
  await expect(f.call('/workspaces',owner,'POST',{name:'bad'},{'X-Language-Studio':''}),403);
  await expect(f.call('/workspaces',owner,'POST',{name:'bad'},{'Content-Type':'text/plain'}),403);
  await expect(f.call('/workspaces',owner,'POST',{name:'bad'},{'Content-Length':'999999999'}),413);
  const request=new Request('https://school.example/api/workspaces',{method:'POST',headers:{'oai-authenticated-user-id':owner.id,'oai-authenticated-user-email':owner.email,Origin:'https://school.example','Content-Type':'application/json','X-Language-Studio':'1'},body:'{bad'});
  assert.equal((await handleApi(request,{DB:f.DB})).status,400);
});
test('parent sees assigned learners only; cannot add, rename, delete or escalate privileges',async()=>{
  const f=await setup();await seed(f);await join(f,parent,'parent',['a']);
  const result=await expect(f.call(f.path+'/data',parent));assert.deepEqual(result.data.learners.map(l=>l.id),['a']);assert.deepEqual(result.data.sessions.map(s=>s.learner),['a']);
  await expect(f.call(f.path+'/members',parent),403);await expect(f.call(f.path+'/invitations',parent,'POST',{email:stranger.email,role:'admin'}),403);
  await expect(save(f,{...result.data,learners:[{id:'a',code:'New code'}]},parent),403);
  await expect(save(f,{version:2,learners:[],sessions:[]},parent),403);
  await expect(save(f,{...result.data,learners:[...result.data.learners,{id:'b',code:'Reader B'}]},parent),403);
  const approved=await expect(save(f,{...result.data,sessions:[...result.data.sessions,sample('a','parent-session')]},parent));assert.equal(approved.data.sessions.length,2);
  const forged={...result.data,sessions:[...result.data.sessions,sample('b','stolen')]};await expect(save(f,forged,parent),400);
  assert.equal((await expect(f.call(f.path+'/data'))).data.sessions.length,3);
});
test('teachers can add and rename learners but cannot delete or manage users',async()=>{
  const f=await setup();await seed(f);await join(f,teacher);
  let current=await expect(f.call(f.path+'/data',teacher));assert.equal(current.data.learners.length,2);
  current=await expect(save(f,{...current.data,learners:[...current.data.learners,{id:'c',code:'Reader C'}]},teacher));
  await expect(save(f,{...current.data,learners:current.data.learners.map(l=>l.id==='c'?{...l,code:'Reader C2'}:l)},teacher));
  await expect(save(f,{...current.data,learners:current.data.learners.filter(l=>l.id!=='c')},teacher),403);
  await expect(f.call(f.path+'/members',teacher),403);
});
test('invitation is email-bound, hashed, single-use and displays only after sign-in',async()=>{
  const f=await setup();await seed(f);const i=await invite(f,parent,'parent',['a']);
  const stored=f.DB.sqlite.prepare('SELECT token_hash FROM invitations WHERE id=?').get(i.id);assert.notEqual(stored.token_hash,i.token);assert.equal(stored.token_hash.length,64);
  await expect(f.call('/invitations/'+i.token,null),401);await expect(f.call('/invitations/'+i.token,stranger),403);
  const preview=await expect(f.call('/invitations/'+i.token,parent));assert.equal(preview.workspaceName,'Classroom');assert.equal(preview.role,'parent');assert.equal(preview.email,undefined);
  await expect(f.call('/invitations/'+i.token,parent,'POST',{}));await expect(f.call('/invitations/'+i.token,parent,'POST',{}),410);
  assert.equal((await expect(f.call('/me',parent))).workspaces.length,1);
});
test('expired, revoked and invalid invitations cannot grant access',async()=>{
  const f=await setup();let i=await invite(f,teacher);f.DB.sqlite.prepare('UPDATE invitations SET expires_at=0 WHERE id=?').run(i.id);
  await expect(f.call('/invitations/'+i.token,teacher,'POST',{}),410);
  i=await invite(f,teacher);await expect(f.call(f.path+'/invitations/'+i.id,owner,'DELETE',{}));await expect(f.call('/invitations/'+i.token,teacher,'POST',{}),410);
  await expect(f.call('/invitations/nope',teacher),404);
});
test('parent invitations require valid assigned learners and role validation',async()=>{
  const f=await setup();await seed(f);
  for(const b of [{role:'parent',learnerIds:[]},{role:'parent',learnerIds:['missing']},{role:'superuser',learnerIds:[]},{role:'parent',learnerIds:['a','a']}])await expect(f.call(f.path+'/invitations',owner,'POST',{email:parent.email,...b}),400);
  await expect(f.call(f.path+'/invitations',owner,'POST',{email:'invalid',role:'teacher',learnerIds:[]}),400);
});
test('owner stays administrator; role changes and revocation take effect immediately',async()=>{
  const f=await setup();await seed(f);await join(f,teacher);
  await expect(f.call(f.path+'/members/'+owner.id,owner,'PATCH',{role:'parent',status:'inactive',learnerIds:['a']}),400);
  await expect(f.call(f.path+'/members/'+teacher.id,owner,'PATCH',{role:'parent',status:'active',learnerIds:['b']}));
  assert.deepEqual((await expect(f.call(f.path+'/data',teacher))).data.learners.map(l=>l.id),['b']);
  await expect(f.call(f.path+'/members/'+teacher.id,owner,'PATCH',{role:'teacher',status:'inactive',learnerIds:[]}));
  await expect(f.call(f.path+'/data',teacher),403);await expect(f.call(f.path+'/changes',teacher,'POST',{data:{version:2,learners:[],sessions:[]},operationId:'x',revision:0}),403);
  assert.equal((await expect(f.call('/me',teacher))).workspaces.length,0);
  assert.equal((await expect(f.call(f.path+'/data'))).data.sessions.length,2);
});
test('revoked administrators cannot leave usable invitation links behind',async()=>{
  const f=await setup();await join(f,teacher,'admin');
  const i=await expect(f.call(f.path+'/invitations',teacher,'POST',{email:parent.email,role:'teacher',learnerIds:[]}),201);
  await expect(f.call(f.path+'/members/'+teacher.id,owner,'PATCH',{role:'teacher',status:'active',learnerIds:[]}));
  await expect(f.call('/invitations/'+new URL(i.url).searchParams.get('invite'),parent,'POST',{}),410);
});
test('completed scores are validated and immutable; duplicate operations are idempotent',async()=>{
  const f=await setup();const first={version:2,learners:[{id:'a',code:'A'}],sessions:[sample('a')]};
  await expect(save(f,first,owner,0,'operation-1'));await expect(save(f,first,owner,0,'operation-1'));
  assert.equal((await expect(f.call(f.path+'/data'))).data.sessions.length,1);
  await expect(save(f,{...first,sessions:[]},owner,0,'operation-1'),409);
  await expect(save(f,{...first,sessions:[]}),400);
  const revised=structuredClone(first);revised.sessions[0].responses[0].note='overwrite';await expect(save(f,revised),409);
  const invalid=structuredClone(first);invalid.sessions.push({...sample('a','invalid'),responses:[{...sample('a').responses[0],domain:'fluency'}]});await expect(save(f,invalid),400);
});
test('stale and simultaneous changes cannot overwrite committed work',async()=>{
  const f=await setup();const base=await seed(f);
  const d1={...base.data,learners:[...base.data.learners,{id:'x',code:'X'}]},d2={...base.data,learners:[...base.data.learners,{id:'y',code:'Y'}]};
  const r=await Promise.all([save(f,d1,owner,base.revision),save(f,d2,owner,base.revision)]);
  assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);
  const latest=await expect(f.call(f.path+'/data'));assert.equal(latest.data.learners.length,3);assert.equal(latest.data.sessions.length,2);
});
test('constraint failure rolls back the entire database mutation and revision',async()=>{
  const f=await setup();const before=await seed(f);await join(f,parent,'parent',['a']);const p=await expect(f.call(f.path+'/data',parent));
  // ID already belongs to an invisible learner; insert must fail without modifying anything else.
  const result={...p.data,sessions:[...p.data.sessions,sample('a','new-valid'),sample('a','session-b')]};
  await expect(save(f,result,parent,p.revision),409);
  const after=await expect(f.call(f.path+'/data'));assert.equal(after.revision,p.revision);assert.deepEqual(after.data,before.data);
});
test('SQL-like text and Unicode duplicate codes are treated as validated data',async()=>{
  const f=await setup();let data={version:2,learners:[{id:'a',code:"A'); DROP TABLE users;--"}],sessions:[]};await expect(save(f,data));
  assert.ok(f.DB.sqlite.prepare('SELECT count(*) AS n FROM users').get().n);
  data={version:2,learners:[{id:'a',code:'é'},{id:'b',code:'e\u0301'}],sessions:[]};await expect(save(f,data),400);
});
test('large valid imports batch bounded JSON chunks and retain every result',async()=>{
  const f=await setup();const sessions=Array.from({length:1000},(_,i)=>{const s=sample('a','bulk-'+i);s.responses[0].evidence='हिन्दी '.repeat(150);return s});
  const saved=await expect(save(f,{version:2,learners:[{id:'a',code:'Bulk'}],sessions}));assert.equal(saved.data.sessions.length,1000);
});
test('drafts are private per adult, survive reload, and reject stale revisions',async()=>{
  const f=await setup();await seed(f);await join(f,teacher);
  const r=await expect(f.call(f.path+'/draft',owner,'PUT',{revision:null,draft:draft()}));
  assert.equal((await expect(f.call(f.path+'/data'))).draft.id,'draft-1');assert.equal((await expect(f.call(f.path+'/data',teacher))).draft,null);
  await expect(f.call(f.path+'/draft',owner,'PUT',{revision:null,draft:{...draft(),note:'stale'}}),409);
  const updated=await expect(f.call(f.path+'/draft',owner,'PUT',{revision:r.draft.revision,draft:{...draft(),note:'new'}}));assert.equal(updated.draft.note,'new');
  await expect(f.call(f.path+'/draft',owner,'DELETE',{id:'draft-1',revision:r.draft.revision}),409);
  await expect(f.call(f.path+'/draft',owner,'DELETE',{id:'draft-1',revision:updated.draft.revision}));assert.equal((await expect(f.call(f.path+'/data'))).draft,null);
});
test('draft evidence validates and parents cannot save drafts for unassigned learners',async()=>{
  const f=await setup();await seed(f);await join(f,parent,'parent',['a']);
  await expect(f.call(f.path+'/draft',parent,'PUT',{revision:null,draft:{...draft(),learner:'b'}}),400);
  for(const d of [{...draft(),chosen:99},{...draft(),heard:['forged']},{...draft(),note:'x'.repeat(501)},{...draft(),index:-1}])await expect(f.call(f.path+'/draft',parent,'PUT',{revision:null,draft:d}),400);
});
test('completion clears all matching drafts and rejects delayed autosaves',async()=>{
  const f=await setup();const current=await seed(f);
  const saved=await expect(f.call(f.path+'/draft',owner,'PUT',{revision:null,draft:draft()}));
  await expect(save(f,{...current.data,sessions:[...current.data.sessions,sample('a','draft-1')]}));assert.equal((await expect(f.call(f.path+'/data'))).draft,null);
  await expect(f.call(f.path+'/draft',owner,'PUT',{revision:saved.draft.revision,draft:draft()}),409);
});
test('learner deletion cascades records, assignments and drafts without affecting other learners',async()=>{
  const f=await setup();await seed(f);await join(f,parent,'parent',['a']);
  await expect(f.call(f.path+'/draft',parent,'PUT',{revision:null,draft:draft()}));
  const current=await expect(f.call(f.path+'/data'));await expect(save(f,{...current.data,learners:current.data.learners.filter(l=>l.id!=='a'),sessions:current.data.sessions.filter(s=>s.learner!=='a')}));
  const p=await expect(f.call(f.path+'/data',parent));assert.equal(p.data.learners.length,0);assert.equal(p.draft,null);
  const all=await expect(f.call(f.path+'/data'));assert.equal(all.data.sessions.length,1);assert.equal(all.data.sessions[0].learner,'b');
});
test('database failure is recoverable and does not expose SQL or stack traces',async()=>{
  const r=await handleApi(new Request('https://school.example/api/me'),{});assert.equal(r.status,503);assert.match((await r.json()).error,/database is not connected/);
  const broken=await handleApi(new Request('https://school.example/api/me',{headers:{'oai-authenticated-user-id':'a','oai-authenticated-user-email':'a@example.test'}}),{DB:{prepare(){throw Error('SQL secret records')}}});assert.equal(broken.status,500);assert.doesNotMatch(await broken.text(),/SQL secret/);
});

test('reissuing an invitation invalidates the older link and preserves other recipients',async()=>{
  const f=await setup();const old=await invite(f,teacher,'admin'),other=await invite(f,parent),fresh=await invite(f,teacher,'teacher');
  await expect(f.call('/invitations/'+old.token,teacher,'POST',{}),410);
  await expect(f.call('/invitations/'+fresh.token,teacher,'POST',{}));
  assert.equal((await expect(f.call(f.path+'/data',teacher))).role,'teacher');
  await expect(f.call('/invitations/'+other.token,parent,'POST',{}));
});
test('pre-upgrade dangling invitations cannot reactivate a removed member; a fresh grant can',async()=>{
  const f=await setup();await seed(f);
  const old=await invite(f,teacher,'admin'),accepted=await invite(f,teacher);
  await expect(f.call('/invitations/'+accepted.token,teacher,'POST',{}));
  // Reconstruct the persisted state left by v5: inactive member and an unused legacy link.
  f.DB.sqlite.prepare("UPDATE memberships SET status='inactive',access_version=0 WHERE user_id=? AND workspace_id=?").run(teacher.id,f.w);
  f.DB.sqlite.prepare('UPDATE invitations SET revoked_at=NULL,recipient_version=NULL WHERE id=?').run(old.id);
  await expect(f.call(f.path+'/data',teacher),403);
  await expect(f.call('/invitations/'+old.token,teacher,'POST',{}),410);
  await expect(f.call(f.path+'/data',teacher),403);
  const fresh=await invite(f,teacher,'parent',['a']);await expect(f.call('/invitations/'+fresh.token,teacher,'POST',{}));
  const result=await expect(f.call(f.path+'/data',teacher));assert.equal(result.role,'parent');assert.deepEqual(result.data.learners.map(l=>l.id),['a']);
});
test('access updates revoke prior recipient grants and demoted issuers cannot revive old grants',async()=>{
  const f=await setup();await seed(f);await join(f,teacher,'admin');
  const issued=await expect(f.call(f.path+'/invitations',teacher,'POST',{email:parent.email,role:'teacher',learnerIds:[]}),201);
  await expect(f.call(f.path+'/members/'+teacher.id,owner,'PATCH',{role:'teacher',status:'inactive',learnerIds:[]}));
  const prior=await invite(f,teacher,'admin');
  await expect(f.call(f.path+'/members/'+teacher.id,owner,'PATCH',{role:'parent',status:'inactive',learnerIds:[]}));
  assert.ok(f.DB.sqlite.prepare('SELECT revoked_at FROM invitations WHERE id=?').get(prior.id).revoked_at);
  await expect(f.call('/invitations/'+prior.token,teacher,'POST',{}),410);
  await expect(f.call(f.path+'/members/'+teacher.id,owner,'PATCH',{role:'admin',status:'active',learnerIds:[]}));
  await expect(f.call('/invitations/'+new URL(issued.url).searchParams.get('invite'),parent,'POST',{}),410);
});
test('removal during invitation acceptance wins without partial reactivation',async()=>{
  const f=await setup();await join(f,teacher);await expect(f.call(f.path+'/members/'+teacher.id,owner,'PATCH',{role:'teacher',status:'inactive',learnerIds:[]}));
  const link=await invite(f,teacher);let release,reached;
  const waiting=new Promise(r=>reached=r),batch=f.DB.batch;
  f.DB.batch=async queries=>{if(queries.some(q=>q._sql.includes('SET accepted_by='))){reached();await new Promise(r=>release=r)}return batch(queries)};
  const accepting=f.call('/invitations/'+link.token,teacher,'POST',{});await waiting;
  await expect(f.call(f.path+'/members/'+teacher.id,owner,'PATCH',{role:'teacher',status:'inactive',learnerIds:[]}));
  release();await expect(accepting,409);await expect(f.call(f.path+'/data',teacher),403);
  await expect(f.call('/invitations/'+link.token,teacher,'POST',{}),410);
});
test('recovery results persist privately, validate evidence and cannot be overwritten',async()=>{
  const f=await setup();await seed(f);await join(f,parent,'parent',['a']);
  const s=sample('a','pending');await expect(f.call(f.path+'/recovery/pending',parent,'PUT',{session:s}));
  await expect(f.call(f.path+'/recovery/pending',parent,'PUT',{session:s}));
  assert.equal((await expect(f.call(f.path+'/data',parent))).recovery.length,1);
  assert.equal((await expect(f.call(f.path+'/data'))).recovery.length,0);
  await expect(f.call(f.path+'/recovery/pending',parent,'PUT',{session:{...s,at:'2026-09-13T10:00:00.000Z'}}),409);
  await expect(f.call(f.path+'/recovery/other',parent,'PUT',{session:sample('b','other')}),403);
  await expect(f.call(f.path+'/recovery/bad',parent,'PUT',{session:{...sample('a','bad'),responses:[{invalid:true}]}}),400);
  await expect(f.call(f.path+'/recovery/pending',owner,'DELETE',{}));
  assert.equal((await expect(f.call(f.path+'/data',parent))).recovery.length,1);
  const current=await expect(f.call(f.path+'/data',parent));await expect(save(f,{...current.data,sessions:[...current.data.sessions,s]},parent));
  assert.equal((await expect(f.call(f.path+'/data',parent))).recovery.length,0);
  assert.equal((await expect(f.call(f.path+'/recovery/pending',parent,'PUT',{session:s}))).completed,true);
});
test('recovery survives workspace capacity and can be exported or explicitly discarded',async()=>{
  const f=await setup();
  const old=Array.from({length:10000},(_,i)=>({...sample('a','old-'+i),responses:[]}));
  await expect(save(f,{version:2,learners:[{id:'a',code:'A'}],sessions:old}));
  const s=sample('a','overflow');await expect(f.call(f.path+'/recovery/overflow',owner,'PUT',{session:s}));
  const snapshot=await expect(f.call(f.path+'/data'));assert.equal(snapshot.capacity.full,true);assert.deepEqual(snapshot.recovery,[s]);
  const rejected=await save(f,{...snapshot.data,sessions:[...old,s]});assert.equal(rejected.status,400);assert.equal(rejected.body.code,'WORKSPACE_CAPACITY');
  assert.deepEqual((await expect(f.call(f.path+'/data'))).recovery,[s]);
  await expect(f.call(f.path+'/recovery/overflow',owner,'DELETE',{}));assert.equal((await expect(f.call(f.path+'/data'))).recovery.length,0);
  assert.equal((await expect(f.call(f.path+'/data'))).data.sessions.length,10000);
});
test('completed recovery rejects delayed drafts and access changes protect retained recovery',async()=>{
  const f=await setup();await seed(f);await join(f,parent,'parent',['a']);
  const d=await expect(f.call(f.path+'/draft',parent,'PUT',{revision:null,draft:draft()}));
  await expect(f.call(f.path+'/recovery/draft-1',parent,'PUT',{session:sample('a','draft-1')}));
  const current=await expect(f.call(f.path+'/data',parent));assert.equal(current.draft,null);assert.equal(current.recovery.length,1);
  await expect(f.call(f.path+'/draft',parent,'PUT',{revision:d.draft.revision,draft:draft()}),409);
  await expect(f.call(f.path+'/draft',parent,'PUT',{revision:null,draft:draft()}),409);
  await expect(f.call(f.path+'/members/'+parent.id,owner,'PATCH',{role:'parent',status:'inactive',learnerIds:[]}));
  await expect(f.call(f.path+'/recovery/draft-1',parent,'PUT',{session:sample('a','draft-1')}),403);
  assert.equal(f.DB.sqlite.prepare('SELECT count(*) AS n FROM recovery_results WHERE workspace_id=? AND user_id=?').get(f.w,parent.id).n,1);
  await expect(f.call(f.path+'/members/'+parent.id,owner,'PATCH',{role:'parent',status:'active',learnerIds:['b']}));
  assert.equal((await expect(f.call(f.path+'/data',parent))).recovery.length,0);
  await expect(f.call(f.path+'/recovery/draft-1',parent,'DELETE',{}),403);
  await expect(f.call(f.path+'/members/'+parent.id,owner,'PATCH',{role:'parent',status:'active',learnerIds:['a']}));
  assert.equal((await expect(f.call(f.path+'/data',parent))).recovery.length,1);
});
test('recovery buffer has an atomic per-adult limit and duplicate retries do not consume it',async()=>{
  const f=await setup();await seed(f);
  for(let i=0;i<10;i++)await expect(f.call(f.path+'/recovery/r-'+i,owner,'PUT',{session:sample('a','r-'+i)}));
  await expect(f.call(f.path+'/recovery/r-0',owner,'PUT',{session:sample('a','r-0')}));
  await expect(f.call(f.path+'/recovery/r-10',owner,'PUT',{session:sample('a','r-10')}),409);
  assert.equal((await expect(f.call(f.path+'/data'))).recovery.length,10);
});
test('schema upgrade preserves existing learners, history and removed memberships',()=>{
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync(new URL('../drizzle/0000_jittery_baron_strucker.sql',import.meta.url),'utf8'));
  db.prepare('INSERT INTO users VALUES (?,?,?,?)').run(owner.id,owner.email,'Owner',1);
  db.prepare('INSERT INTO users VALUES (?,?,?,?)').run(teacher.id,teacher.email,'Teacher',1);
  db.prepare('INSERT INTO workspaces (id,name,owner_id,created_at) VALUES (?,?,?,?)').run('legacy','Legacy',owner.id,1);
  db.prepare('INSERT INTO memberships (workspace_id,user_id,role,status,joined_at) VALUES (?,?,?,?,?)').run('legacy',teacher.id,'teacher','inactive',1);
  db.prepare('INSERT INTO learners VALUES (?,?,?,?,?,?,?)').run('legacy','a','Reader A','reader a',owner.id,1,1);
  const payload=JSON.stringify(sample('a'));
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?)').run('legacy','session-1','a',payload,'en-IN',1,'diagnostic','2026-09-12T10:00:00.000Z',1,owner.id);
  for(const name of ['0001_aspiring_scalphunter.sql','0002_loving_vision.sql'])db.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
  assert.equal(db.prepare('SELECT payload FROM sessions').get().payload,payload);
  assert.equal(db.prepare('SELECT code FROM learners').get().code,'Reader A');
  const member=db.prepare('SELECT status,access_version FROM memberships').get();assert.equal(member.status,'inactive');assert.equal(member.access_version,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM recovery_results').get().n,0);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
});

const progressPath=(f,lid='a',query='')=>f.path+'/learners/'+lid+'/progress?lang=en-IN&level=1'+query;
const append=(f,s,user=owner)=>f.call(f.path+'/sessions/'+s.id,user,'PUT',{session:s});

test('compact bootstrap excludes history and counts only authorized records',async()=>{
  const f=await setup();await seed(f);await join(f,parent,'parent',['a']);
  const p=await expect(f.call(f.path+'/bootstrap',parent));
  assert.deepEqual(p.data.sessions,[]);assert.equal(p.total,1);assert.deepEqual(p.data.learners.map(l=>l.id),['a']);
  assert.equal((await expect(f.call(f.path+'/bootstrap'))).total,2);
  await expect(f.call(f.path+'/bootstrap',stranger),403);
});
test('single result insertion is immutable, idempotent and clears recovery and drafts atomically',async()=>{
  const f=await setup();await seed(f);
  await expect(f.call(f.path+'/draft',owner,'PUT',{revision:null,draft:draft()}));
  const s=sample('a','draft-1');await expect(f.call(f.path+'/recovery/draft-1',owner,'PUT',{session:s}));
  const first=await expect(append(f,s));assert.equal(first.duplicate,false);assert.deepEqual(first.session,s);
  const before=await expect(f.call(f.path+'/bootstrap'));
  assert.equal(before.draft,null);assert.deepEqual(before.recovery,[]);assert.equal(before.total,3);
  assert.equal((await expect(append(f,s))).duplicate,true);
  await expect(append(f,{...s,at:'2026-09-14T00:00:00.000Z'}),409);
  assert.equal((await expect(f.call(f.path+'/bootstrap'))).revision,before.revision);
  assert.equal(f.DB.sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE action='result.saved'").get().n,1);
  await expect(f.call(f.path+'/draft',owner,'PUT',{revision:null,draft:draft()}),409);
});
test('concurrent independent result saves succeed without client revision refresh',async()=>{
  const f=await setup();await seed(f);await join(f,teacher);
  const r=await Promise.all([append(f,sample('a','adult-one')),append(f,sample('b','adult-two'),teacher)]);
  assert.deepEqual(r.map(x=>x.status),[200,200]);
  const all=await expect(f.call(f.path+'/data'));assert.equal(all.data.sessions.length,4);
  const same=sample('a','same-finish'),duplicates=await Promise.all([append(f,same),append(f,same,teacher)]);
  assert.deepEqual(duplicates.map(x=>x.status),[200,200]);assert.equal(duplicates.filter(x=>x.body.duplicate).length,1);
});
test('incremental writes and paged reads enforce learner and workspace isolation',async()=>{
  const f=await setup();await seed(f);await join(f,parent,'parent',['a']);
  await expect(append(f,sample('a','parent-result'),parent));
  await expect(append(f,sample('b','forged'),parent),403);
  await expect(append(f,sample('a','session-b'),parent),409);
  await expect(append(f,sample('a','intruder'),stranger),403);
  await expect(f.call(progressPath(f,'b'),parent),403);await expect(f.call(progressPath(f),stranger),403);
  const p=await expect(f.call(progressPath(f),parent));assert.ok(p.sessions.every(s=>s.learner==='a'));
  await expect(f.call(f.path+'/sessions/invalid',parent,'PUT',{session:{...sample('a','invalid'),responses:[{}]}}),400);
  await expect(f.call(f.path+'/members/'+parent.id,owner,'PATCH',{role:'parent',status:'inactive',learnerIds:[]}));
  await expect(append(f,sample('a','parent-result'),parent),403);await expect(f.call(progressPath(f),parent),403);
});
test('revocation immediately before the result transaction prevents the write',async()=>{
  const f=await setup();await seed(f);await join(f,parent,'parent',['a']);let reached,release;
  const waiting=new Promise(r=>reached=r),batch=f.DB.batch;
  f.DB.batch=async queries=>{if(queries.some(q=>q._sql.startsWith('INSERT INTO sessions')&&q._args[1]==='blocked')){reached();await new Promise(r=>release=r)}return batch(queries)};
  const pending=append(f,sample('a','blocked'),parent);await waiting;
  await expect(f.call(f.path+'/members/'+parent.id,owner,'PATCH',{role:'parent',status:'inactive',learnerIds:[]}));
  release();await expect(pending,403);
  assert.equal((await expect(f.call(f.path+'/bootstrap'))).total,2);
});
test('concurrent saves compete atomically for the last workspace slot and retain recovery',async()=>{
  const f=await setup();const old=Array.from({length:9999},(_,i)=>({...sample('a','old-'+i),responses:[]}));
  await expect(save(f,{version:2,learners:[{id:'a',code:'A'}],sessions:old}));
  const a=sample('a','slot-a'),b=sample('a','slot-b');
  for(const s of [a,b])await expect(f.call(f.path+'/recovery/'+s.id,owner,'PUT',{session:s}));
  const results=await Promise.all([append(f,a),append(f,b)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);assert.equal(results.find(r=>r.status===400).body.code,'WORKSPACE_CAPACITY');
  const after=await expect(f.call(f.path+'/bootstrap'));assert.equal(after.total,10000);assert.equal(after.recovery.length,1);
  assert.equal(after.recovery[0].id,results[0].status===400?a.id:b.id);
});
test('paged history retains exact per-skill evidence, practice separation and exposure from old items',async()=>{
  const {domainSummary}=await import('../src/engine.mjs');
  const f=await setup(),bank=makeBank('en-IN',1,'A'),sessions=[];
  // Early checks contain each skill; many newer practice sessions must not replace them.
  for(let i=0;i<26;i++){
    const q=bank[i%bank.length],s=sample('a','skill-'+i);s.at=new Date(Date.UTC(2026,0,1,i)).toISOString();
    s.responses=[{item:q.id,domain:q.domain,score:2,supported:false,answer:q.kind==='choice'?q.answer:2,response:q.kind==='choice'?q.options[q.answer]:'Independent'}];sessions.push(s);
  }
  for(let i=0;i<45;i++)sessions.push({...sample('a','practice-'+i),mode:'practice',at:new Date(Date.UTC(2026,1,1,i)).toISOString()});
  sessions.push({...sample('a','skipped'),at:'2026-03-01T00:00:00Z',responses:[{item:bank[0].id,domain:bank[0].domain,score:null,answer:null,response:'',supported:false}]});
  const full={version:2,learners:[{id:'a',code:'A'}],sessions};await expect(save(f,full));
  const p=await expect(f.call(progressPath(f)));assert.equal(p.total,72);assert.equal(p.practice,45);assert.equal(p.history.ids.length,20);assert.ok(p.sessions.length<=36);assert.equal(p.seen.length,13);
  const actual=domainSummary({...full,sessions:p.sessions},'a','en-IN',1),expected=domainSummary(full,'a','en-IN',1);
  assert.deepEqual(actual,expected);
  const visited=[];let current=p;
  for(;;){visited.push(...current.history.ids);if(!current.history.hasNext)break;current=await expect(f.call(progressPath(f,'a','&page='+(current.history.page+1)+'&revision='+p.revision)));assert.ok(current.sessions.length<=39)}
  const {compareSessions}=await import('../src/engine.mjs');assert.deepEqual(visited,[...sessions].sort((a,b)=>compareSessions(b,a)).map(s=>s.id));assert.equal(new Set(visited).size,sessions.length);
});
test('history ordering supports tied instants, offsets and legacy date strings',async()=>{
  const f=await setup(),sessions=Array.from({length:46},(_,i)=>({...sample('a','id-'+String(i).padStart(3,'0')),at:['2026-09-01T02:00:00+02:00','2026-09-01T00:00:00Z','09/01/2026 00:00:00 GMT'][i%3]}));
  await expect(save(f,{version:2,learners:[{id:'a',code:'A'}],sessions}));const ids=[];let p=await expect(f.call(progressPath(f)));
  for(;;){ids.push(...p.history.ids);if(!p.history.hasNext)break;p=await expect(f.call(progressPath(f,'a','&page='+(p.history.page+1)+'&revision='+p.revision)))}
  assert.deepEqual(ids,sessions.map(s=>s.id).reverse());
});
test('history pages reject invalid parameters and stale revisions after a concurrent save',async()=>{
  const f=await setup();await seed(f);
  const p=await expect(f.call(progressPath(f)));await expect(append(f,sample('a','newer')));
  const stale=await f.call(progressPath(f,'a','&page=1&revision='+p.revision));assert.equal(stale.status,409);assert.equal(stale.body.code,'HISTORY_CHANGED');
  for(const q of ['&page=-1','&page=1','&page=1&revision=no','&page=500&revision=1','&page=0&revision=-1'])await expect(f.call(progressPath(f,'a',q)),400);
  await expect(f.call(f.path+'/learners/a/progress?lang=xx&level=1'),400);
});
test('progress detects access removal between metadata and evidence reads',async()=>{
  const f=await setup();await seed(f);await join(f,parent,'parent',['a']);let reached,release;
  const waiting=new Promise(r=>reached=r),batch=f.DB.batch;
  f.DB.batch=async queries=>{if(queries.some(q=>q._sql.includes('SELECT s.payload')&&q._sql.includes('s.id IN'))){reached();await new Promise(r=>release=r)}return batch(queries)};
  const reading=f.call(progressPath(f),parent);await waiting;
  await expect(f.call(f.path+'/members/'+parent.id,owner,'PATCH',{role:'parent',status:'inactive',learnerIds:[]}));release();await expect(reading,403);
});

test('atomic byte capacity stays within 10 MiB and a near-full JSON backup restores',async()=>{
  const {validSession}=await import('../src/engine.mjs');const f=await setup();await expect(save(f,{version:2,learners:[{id:'a',code:'A'}],sessions:[]}));
  const limit=10*1024*1024,s=sample('a','bytes-00000');s.responses[0].evidence='अ'.repeat(1900);assert.equal(validSession(s),true);
  const size=Buffer.byteLength(JSON.stringify(s)),n=Math.floor(limit/size),insert=f.DB.sqlite.prepare('INSERT INTO sessions (workspace_id,id,learner_id,payload,lang,level,mode,at,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for(let i=0;i<n;i++){const r={...s,id:'bytes-'+String(i).padStart(5,'0')};insert.run(f.w,r.id,'a',JSON.stringify(r),r.lang,r.level,r.mode,r.at,1,owner.id)}
  const rejected=await append(f,{...s,id:'byte-overflow'});assert.equal(rejected.status,400);assert.equal(rejected.body.code,'WORKSPACE_CAPACITY');
  const full=await expect(f.call(f.path+'/data')),raw=JSON.stringify(full.data);assert.ok(Buffer.byteLength(raw)<=12*1024*1024);
  const other=await expect(f.call('/workspaces',owner,'POST',{name:'Restored'}),201),copy={...f,path:'/workspaces/'+other.workspaceId};
  await expect(save(copy,JSON.parse(raw)));assert.equal((await expect(f.call(copy.path+'/bootstrap'))).total,n);
  assert.ok(f.DB.sqlite.prepare('SELECT sum(length(CAST(payload AS BLOB))) AS n FROM sessions WHERE workspace_id=?').get(other.workspaceId).n<=limit);
});
test('a failed incremental transaction rolls back its revision and preserves the recovery copy',async()=>{
  const f=await setup();await seed(f);const s=sample('a','transaction-failure');
  await expect(f.call(f.path+'/recovery/'+s.id,owner,'PUT',{session:s}));const before=await expect(f.call(f.path+'/bootstrap'));
  f.DB.sqlite.exec("CREATE TRIGGER fail_result BEFORE INSERT ON sessions WHEN NEW.id='transaction-failure' BEGIN SELECT RAISE(ABORT,'simulated failure'); END");
  await expect(append(f,s),500);const after=await expect(f.call(f.path+'/bootstrap'));
  assert.equal(after.revision,before.revision);assert.equal(after.total,2);assert.deepEqual(after.recovery,[s]);
});
test('reading history keeps the latest two checks and total check count without practice contamination',async()=>{
  const {domainSummary}=await import('../src/engine.mjs');const f=await setup();
  const sessions=Array.from({length:30},(_,i)=>({id:'reading-'+i,learner:'a',lang:'en-IN',level:1,mode:i<5?'fluency':'practice',domain:'fluency',form:'reader',at:new Date(Date.UTC(2026,0,1,i)).toISOString(),responses:[],seconds:60,passage:'Reading',metrics:{correct:8,error:2,skipped:0,attempted:10,cwpm:8,accuracy:80}}));
  await expect(save(f,{version:2,learners:[{id:'a',code:'A'}],sessions}));
  const p=await expect(f.call(progressPath(f)));assert.equal(p.fluency,5);assert.equal(p.practice,25);
  const d=domainSummary({sessions:p.sessions},'a','en-IN',1).find(d=>d.id==='fluency');assert.equal(d.latest.id,'reading-4');assert.equal(d.previous.id,'reading-3');
});

test('device recovery keys are private to the authenticated adult, stable and never included in workspace exports',async()=>{
  const f=await setup();await seed(f);
  await expect(f.call('/me/device-recovery-key',null,'POST',{}),401);
  await expect(f.call('/me/device-recovery-key',owner,'POST',{}, {Origin:'https://evil.test'}),403);
  const [a,b]=await Promise.all([expect(f.call('/me/device-recovery-key',owner,'POST',{})),expect(f.call('/me/device-recovery-key',owner,'POST',{}))]);
  assert.match(a.key,/^[a-f0-9]{64}$/);assert.equal(a.key,b.key);
  const other=await expect(f.call('/me/device-recovery-key',teacher,'POST',{}));assert.notEqual(a.key,other.key);
  await expect(f.call('/me/device-recovery-key',teacher,'POST',{userId:owner.id}),400);
  const again=await f.call('/me/device-recovery-key',owner,'POST',{});assert.equal(again.headers.get('cache-control'),'no-store');assert.equal(again.body.key,a.key);
  for(const path of ['/me',f.path+'/data',f.path+'/bootstrap',f.path+'/members'])assert.ok(!JSON.stringify(await expect(f.call(path))).includes(a.key));
});
test('device recovery schema upgrade preserves existing user identities and creates no keys implicitly',()=>{
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../drizzle/0000_jittery_baron_strucker.sql',import.meta.url),'utf8'));
  db.prepare('INSERT INTO users VALUES (?,?,?,?)').run(owner.id,owner.email,'Owner',1);
  for(const name of ['0001_aspiring_scalphunter.sql','0002_loving_vision.sql','0003_minor_martin_li.sql'])db.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
  const row=db.prepare('SELECT * FROM users').get();assert.equal(row.id,owner.id);assert.equal(row.email,owner.email);assert.equal(row.device_recovery_key,null);db.close();
});

test('an account assertion prevents old tabs from reading or saving after the authenticated adult changes',async()=>{
  const f=await setup();await seed(f);await join(f,teacher);
  const mismatch={'X-Language-Studio-Account':owner.id};
  for(const [path,method,b] of [[f.path+'/data','GET'],['/me/device-recovery-key','POST',{}],[f.path+'/sessions/switched','PUT',{session:sample('a','switched')}]]){
    const result=await f.call(path,teacher,method,b,mismatch);assert.equal(result.status,401);assert.equal(result.body.code,'ACCOUNT_CHANGED');
  }
  await expect(f.call(f.path+'/data',teacher,'GET',undefined,{'X-Language-Studio-Account':teacher.id}));
  assert.equal((await expect(f.call(f.path+'/bootstrap'))).total,2);
});
