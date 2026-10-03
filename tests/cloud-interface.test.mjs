import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {harness} from './dom-harness.mjs';
import {handleApi} from '../server/api.mjs';
import {localDatabase} from '../server/local-db.mjs';
import worker from '../dist/server/index.js';

const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
const markup=readFileSync(new URL('../src/index.html',import.meta.url),'utf8');
const bundle=html.match(/<script type="module">([\s\S]*)<\/script>/)[1];
const owner={id:'ui-owner',email:'owner@example.test'},parent={id:'ui-parent',email:'parent@example.test'};
async function client(DB,user=owner,legacy,sharedStore){
  const transport={fail:false,dropAfterCommit:false,requests:[],identity:user};
  const fetch=async(path,init={})=>{
    transport.requests.push({path,method:init.method||'GET',body:init.body});
    if(transport.fail)throw Error('Connection interrupted');
    if(transport.hold&&path.includes(transport.hold.suffix)){
      const hold=transport.hold;transport.hold=null;hold.arrived();await hold.wait;
    }
    const response=await handleApi(new Request('https://school.example'+path,{...init,headers:{...init.headers,Origin:'https://school.example',...(transport.identity?{'oai-authenticated-user-id':transport.identity.id,'oai-authenticated-user-email':transport.identity.email}:{})}}),{DB});
    if(transport.dropAfterCommit&&path.includes('/sessions/')){transport.dropAfterCommit=false;throw Error('Response was lost after commit')}
    return response;
  };
  const app=harness(markup,{CLOUD_MODE:true,fetch,sharedStore,location:{hash:'',origin:'https://school.example',pathname:'/',search:''}});
  if(legacy)app.store.set('language-studio-v2',JSON.stringify(legacy));
  app.run(bundle);await app.run('cloudState.initPromise');
  app.transport=transport;
  app.holdRequest=suffix=>{let arrived,release;const reached=new Promise(r=>arrived=r),wait=new Promise(r=>release=r);transport.hold={suffix,arrived,wait};return {reached,release}};
  app.submit=async(form)=>Promise.all((app.events.get('submit')||[]).map(fn=>fn({preventDefault(){},target:{closest:()=>form}})));
  return app;
}
function workspaceForm(name){const submit={disabled:false},error={textContent:''};return {dataset:{cloudForm:'workspace'},elements:{workspaceName:{value:name}},querySelector:s=>s==='[type="submit"]'?submit:error}}
async function setup(){const DB=localDatabase(),app=await client(DB);await app.submit(workspaceForm('Our class'));assert.equal(app.run('cloudState.status'),'ready');return {DB,app}}
async function addLearner(app,code='Reader 01'){
  app.nodes.get('learnerCode').value=code;app.nodes.get('setupLanguage').value='en-IN';app.nodes.get('setupLevel').value='1';
  app.nodes.get('learnerForm').onsubmit({preventDefault(){}});await app.run('cloudState.writeQueue');
}
async function complete(app){app.run("startRun('diagnostic','sounds');while(run){run.chosen=2;nextTask()}");await app.run('cloudState.writeQueue');await app.run('cloudState.draftQueue')}

test('hosted Worker enables cloud mode and prevents caching or unknown pages',async()=>{
  const r=await worker.fetch(new Request('https://school.example/'),{DB:localDatabase()});assert.match(await r.text(),/window.CLOUD_MODE=true/);assert.equal(r.headers.get('cache-control'),'no-store');
  assert.equal((await worker.fetch(new Request('https://school.example/server/index.js'),{})).status,404);
});
test('anonymous gate does not read browser learners and offers top-level ChatGPT sign-in',async()=>{
  const app=await client(localDatabase(),null,{version:2,learners:[{id:'legacy',code:'Private legacy'}],sessions:[]});
  assert.equal(app.run('cloudState.status'),'anonymous');assert.equal(app.run('data.learners.length'),0);assert.equal(app.nodes.get('dataBtn').hidden,true);
  assert.match(app.nodes.get('workspace').innerHTML,/target="_top"/);assert.match(app.nodes.get('workspace').innerHTML,/Sign in with ChatGPT/);assert.doesNotMatch(app.nodes.get('workspace').innerHTML,/Private legacy/);
});
test('workspace creation, learner setup, completed check and a second device share database records',async()=>{
  const {DB,app}=await setup();await addLearner(app);await complete(app);
  assert.equal(app.run('data.sessions.length'),1);assert.equal(app.run('hasUnsaved'),false);assert.match(app.nodes.get('activityContent').innerHTML,/Here’s how it went/);
  assert.equal(app.store.has('language-studio-v2'),false);
  const second=await client(DB);assert.equal(second.run('learner().code'),'Reader 01');assert.equal(second.run('data.sessions.length'),1);assert.equal(second.run('cloudState.role'),'admin');
  second.run('dataDialog()');assert.match(second.nodes.get('dataStats').textContent,/Our class/);
});
test('pause saves to the database and another device can resume and complete it',async()=>{
  const {DB,app}=await setup();await addLearner(app);
  app.run("startRun('diagnostic','sounds');run.chosen=1;nextTask();closeActivity()");await app.run('cloudState.draftQueue');
  assert.equal(app.run('hasUnsaved'),false);
  const other=await client(DB);assert.equal(other.run('readDraft().answers.length'),1);
  other.run('resumeRun();run.chosen=2;nextTask()');await other.run('cloudState.writeQueue');await other.run('cloudState.draftQueue');
  assert.equal(other.run('hasUnsaved'),false);assert.equal(other.run('data.sessions.length'),1);assert.equal(other.run('readDraft()'),null);
  assert.equal((await client(DB)).run('readDraft()'),null);
});
test('failed result save stays separate from progress and Retry saves it without loss',async()=>{
  const {DB,app}=await setup();await addLearner(app);app.transport.fail=true;await complete(app);
  assert.equal(app.run('data.sessions.length'),0);assert.equal(app.run('cloudState.recoveries.size'),1);assert.equal(app.run('[...cloudState.recoveries.values()][0].stored'),false);assert.equal(app.run('recordsUnsaved'),true);assert.equal(app.run('hasUnsaved'),true);
  app.run('dataDialog()');assert.equal(app.nodes.get('retryCloudSave').hidden,false);
  app.transport.fail=false;await app.nodes.get('retryCloudSave').onclick();await app.run('cloudState.writeQueue');await app.run('cloudState.draftQueue');
  assert.equal(app.run('hasUnsaved'),false);assert.equal((await client(DB)).run('data.sessions.length'),1);
});
test('a dropped response retries the same operation safely without duplicate results',async()=>{
  const {DB,app}=await setup();await addLearner(app);app.transport.dropAfterCommit=true;await complete(app);
  assert.equal(app.run('recordsUnsaved'),false);assert.equal((await client(DB)).run('data.sessions.length'),1);
});
test('two adults adding learners from stale pages preserve both additions',async()=>{
  const {DB,app}=await setup();const second=await client(DB);
  await addLearner(app,'First');await addLearner(second,'Second');
  assert.deepEqual(JSON.parse(second.run('JSON.stringify(data.learners.map(l=>l.code).sort())')),['First','Second']);assert.equal((await client(DB)).run('data.learners.length'),2);
});
test('browser migration requires an explicit action and preserves the original copy',async()=>{
  const {DB}=await setup(),legacy={version:2,learners:[{id:'legacy',code:'Old learner'}],sessions:[]},app=await client(DB,owner,legacy);
  assert.equal(app.run('data.learners.length'),0);app.run('dataDialog()');assert.equal(app.nodes.get('legacyImport').hidden,false);
  app.nodes.get('legacyImport').onclick();await app.run('cloudState.writeQueue');assert.equal(app.run('data.learners.length'),1);assert.equal(JSON.parse(app.store.get('language-studio-v2')).learners.length,1);
});
test('parent UI hides learner management and displays only assigned children',async()=>{
  const {DB,app}=await setup();await addLearner(app,'Assigned');await addLearner(app,'Other');
  const link=await app.run("cloudRequest(cloudPath('/invitations'),'POST',{email:'parent@example.test',role:'parent',learnerIds:[data.learners[0].id]})");
  const token=new URL(link.url).searchParams.get('invite');const p=await client(DB,parent);
  await p.run("cloudRequest('/invitations/"+token+"','POST',{})");await p.run('cloudInit()');
  assert.equal(p.run('data.learners.length'),1);assert.equal(p.run('learner().code'),'Assigned');assert.equal(p.nodes.get('addLearner').hidden,true);
  p.run('cloudAccount()');assert.doesNotMatch(p.nodes.get('accountContent').innerHTML,/Manage users/);p.run('dataDialog()');assert.equal(p.nodes.get('renameBtn').disabled,true);assert.equal(p.nodes.get('deleteLearner').disabled,true);
});
test('draft conflict preserves this tab’s answer and explains another-device change',async()=>{
  const {DB,app}=await setup();await addLearner(app);app.run("startRun('diagnostic','sounds');closeActivity()");await app.run('cloudState.draftQueue');
  const other=await client(DB);app.run('resumeRun();run.note="first device";saveDraft()');await app.run('cloudFlushDraft()');
  other.run('resumeRun();run.note="second device";saveDraft()');await other.run('cloudFlushDraft()');
  assert.equal(other.run('draftUnsaved'),true);assert.equal(other.run('run.note'),'second device');assert.match(other.nodes.get('toast').textContent,/another device/);
});

test('delayed completion does not replace a newer activity or cancel its pending draft',async()=>{
  const {DB,app}=await setup();await addLearner(app);
  app.run("startRun('diagnostic','sounds');run.chosen=2;nextTask();run.chosen=2");
  const held=app.holdRequest('/sessions/');app.run('nextTask()');await held.reached;
  app.run("closeActivity();clearDraft(readDraft()?.id);startRun('diagnostic','vocabulary');run.note='Keep this new note';saveDraft()");
  const newId=app.run('run.id');assert.equal(app.run('!!cloudState.pendingDraft'),true);
  held.release();await app.run('cloudState.writeQueue');await app.run('cloudState.draftQueue');
  assert.equal(app.run('run.id'),newId);assert.equal(app.run('run.note'),'Keep this new note');
  assert.equal(app.run('cloudState.pendingDraft.id'),newId);assert.equal(app.run('hasUnsaved'),true);
  await app.run('cloudFlushDraft()');assert.equal(app.run('hasUnsaved'),false);
  const reloaded=await client(DB);assert.equal(reloaded.run('readDraft().id'),newId);assert.equal(reloaded.run('readDraft().note'),'Keep this new note');
});
test('delayed completion preserves the revision of a newer draft already saved to the database',async()=>{
  const {DB,app}=await setup();await addLearner(app);
  app.run("startRun('diagnostic','sounds');run.chosen=2;nextTask();run.chosen=2");
  const held=app.holdRequest('/sessions/');app.run('nextTask()');await held.reached;
  app.run("closeActivity();clearDraft(readDraft()?.id);startRun('diagnostic','vocabulary');run.note='New saved note';saveDraft()");
  await app.run('cloudFlushDraft()');const revision=app.run('draftRevision'),id=app.run('run.id');assert.ok(revision);
  held.release();await app.run('cloudState.writeQueue');await app.run('cloudState.draftQueue');
  assert.equal(app.run('run.id'),id);assert.equal(app.run('draftRevision'),revision);
  app.run("run.note='A later change';saveDraft()");await app.run('cloudFlushDraft()');
  assert.equal(app.run('hasUnsaved'),false);assert.equal((await client(DB)).run('readDraft().note'),'A later change');
});
test('closing a saving activity does not reopen its result dialog later',async()=>{
  const {app}=await setup();await addLearner(app);app.run("startRun('diagnostic','sounds');run.chosen=2;nextTask();run.chosen=2");
  const held=app.holdRequest('/sessions/');app.run('nextTask()');await held.reached;
  app.run('closeActivity()');held.release();await app.run('cloudState.writeQueue');await app.run('cloudState.draftQueue');
  assert.equal(app.nodes.get('activityDialog').open,false);assert.equal(app.run('data.sessions.length'),1);
});
test('a queued draft acknowledgement cannot reset a newer draft after discard',async()=>{
  const {DB,app}=await setup();await addLearner(app);app.run("startRun('diagnostic','sounds');run.note='Old note';saveDraft()");
  const held=app.holdRequest('/draft');app.run('cloudFlushDraft()');await held.reached;
  app.run("closeActivity();clearDraft(readDraft()?.id);startRun('diagnostic','vocabulary');run.note='New note';saveDraft();cloudFlushDraft()");
  held.release();await app.run('cloudState.draftQueue');
  assert.equal(app.run('run.domain'),'vocabulary');assert.equal(app.run('hasUnsaved'),false);
  assert.equal((await client(DB)).run('readDraft().note'),'New note');
});
test('a capacity failure retains the complete result across reload and exports a restorable recovery',async()=>{
  const {DB,app}=await setup();await addLearner(app);
  await app.run("cloudRequest(cloudPath('/changes'),'POST',{revision:cloudState.revision,operationId:'capacity-seed',data:{...data,sessions:Array.from({length:10000},(_,i)=>({id:'historical-'+i,learner:selected,lang:'en-IN',level:1,mode:'diagnostic',form:'A',at:'2026-09-01T00:00:00.000Z',responses:[]}))}}).then(cloudAdopt)");
  await app.run('cloudLoadProgress()');
  await complete(app);
  assert.equal(app.run('cloudState.progress.total'),10000);assert.equal(app.run('data.sessions.length'),20);assert.equal(app.run('cloudState.recoveries.size'),1);
  assert.equal(app.run('[...cloudState.recoveries.values()][0].stored'),true);
  assert.equal(app.run('[...cloudState.recoveries.values()][0].session.responses.length'),2);
  assert.equal(app.run('recordsUnsaved'),true);assert.match(app.nodes.get('cloudSaveStatus').textContent,/saved for recovery/);
  const other=await client(DB);assert.equal(other.run('cloudState.recoveries.size'),1);assert.equal(other.nodes.get('cloudRecoveryBanner').hidden,false);assert.equal(other.nodes.get('cloudCapacityNotice').hidden,false);
  other.run("cloudExportResult([...cloudState.recoveries.keys()][0])");const exported=other.nodes.get('exportText').value;
  assert.equal(other.run('validateBackup('+exported+')'),true);assert.equal(JSON.parse(exported).sessions[0].responses.length,2);
  other.run('cloudAccount()');assert.match(other.nodes.get('accountContent').innerHTML,/signout-with-chatgpt/);
  await other.submit(workspaceForm('Next learning space'));assert.equal(other.run('cloudState.recoveries.size'),0);
  other.run('importBackupText('+JSON.stringify(exported)+')');await other.run('cloudState.writeQueue');assert.equal(other.run('data.sessions.length'),1);
  assert.equal((await client(DB)).run('cloudState.recoveries.size'),1);
});
test('a stored recovery survives interruption before final history save and Retry is idempotent',async()=>{
  const {DB,app}=await setup();await addLearner(app);app.run("startRun('diagnostic','sounds');run.chosen=2;nextTask();run.chosen=2");
  const held=app.holdRequest('/sessions/');app.run('nextTask()');await held.reached;
  const other=await client(DB);assert.equal(other.run('data.sessions.length'),0);assert.equal(other.run('cloudState.recoveries.size'),1);
  await other.run('cloudRetryResult([...cloudState.recoveries.keys()][0])');await other.run('cloudState.draftQueue');
  assert.equal(other.run('data.sessions.length'),1);assert.equal(other.run('cloudState.recoveries.size'),0);
  held.release();await app.run('cloudState.writeQueue');await app.run('cloudState.draftQueue');
  assert.equal((await client(DB)).run('data.sessions.length'),1);assert.equal(app.run('hasUnsaved'),false);
});

async function seedHistory(app,count=65){
  const fresh=await app.run("cloudRequest(cloudPath('/bootstrap'))");
  await app.run(`cloudRequest(cloudPath('/changes'),'POST',{revision:${fresh.revision},operationId:uid(),data:{...data,sessions:Array.from({length:${count}},(_,i)=>{const q=makeBank('en-IN',1,'A')[i%13];return {id:'history-'+String(i).padStart(3,'0'),learner:selected,lang:'en-IN',level:1,mode:i<13?'diagnostic':'practice',form:'A',at:new Date(Date.UTC(2026,0,1,i)).toISOString(),responses:[{item:q.id,domain:q.domain,score:2,supported:false,answer:q.kind==='choice'?q.answer:2,response:q.kind==='choice'?q.options[q.answer]:'Independent'}]}})}}).then(cloudAdopt)`);
  await app.run('cloudLoadProgress()');
}
test('opening progress and finishing a result transfer bounded records without the full history endpoint',async()=>{
  const {DB,app}=await setup();await addLearner(app);await seedHistory(app,250);
  const other=await client(DB);assert.equal(other.run('cloudState.progress.total'),250);assert.ok(other.run('data.sessions.length')<=36);
  assert.ok(!other.transport.requests.some(r=>r.path.endsWith('/data')));
  const before=other.transport.requests.length;await complete(other);
  const requests=other.transport.requests.slice(before),writes=requests.filter(r=>r.method==='PUT'&&r.path.includes('/sessions/'));
  assert.equal(writes.length,1);assert.deepEqual(Object.keys(JSON.parse(writes[0].body)),['session']);assert.ok(writes[0].body.length<2500);
  assert.ok(!requests.some(r=>r.path.endsWith('/changes')||r.path.endsWith('/data')));
  assert.equal(other.run('cloudState.progress.total'),251);assert.ok(other.run('data.sessions.length')<=36);
  const reload=await client(DB);assert.equal(reload.run('cloudState.progress.total'),251);
});
test('paged report shows complete totals, stable skill evidence and older result details',async()=>{
  const {app}=await setup();await addLearner(app);await seedHistory(app);app.run("view='report';render()");
  assert.match(app.nodes.get('workspace').innerHTML,/65<\/strong><span>Activities completed/);assert.match(app.nodes.get('workspace').innerHTML,/52<\/strong><span>Practice sessions/);
  assert.match(app.nodes.get('workspace').innerHTML,/1–20 of 65/);
  const summary=app.run('JSON.stringify(summary())'),ids=JSON.parse(app.run('JSON.stringify(cloudState.progress.history.ids)'));
  await app.run('cloudLoadProgress(1)');assert.match(app.nodes.get('workspace').innerHTML,/21–40 of 65/);assert.equal(app.run('JSON.stringify(summary())'),summary);
  const next=JSON.parse(app.run('JSON.stringify(cloudState.progress.history.ids)'));assert.ok(next.every(id=>!ids.includes(id)));assert.ok(app.run('data.sessions.length')<=39);
  app.run('showSession(data.sessions.find(s=>s.id===cloudState.progress.history.ids[0]))');assert.match(app.nodes.get('activityContent').innerHTML,/Practice complete/);assert.match(app.nodes.get('activityContent').innerHTML,/See answers and teaching notes/);
  await app.run('cloudLoadProgress(0)');assert.deepEqual(JSON.parse(app.run('JSON.stringify(cloudState.progress.history.ids)')),ids);
});
test('JSON and CSV exports include records beyond the visible page and across contexts',async()=>{
  const {app}=await setup();await addLearner(app);await seedHistory(app);
  await app.run(`cloudRequest(cloudPath('/data')).then(f=>cloudRequest(cloudPath('/changes'),'POST',{revision:f.revision,operationId:uid(),data:{...f.data,sessions:[...f.data.sessions,{id:'hindi-other-level',learner:selected,lang:'hi-IN',level:2,mode:'diagnostic',form:'A',at:'2026-08-01T00:00:00Z',responses:[(()=>{const q=makeBank('hi-IN',2,'A')[0];return {item:q.id,domain:q.domain,score:2,supported:false,answer:2,response:'Independent'}})()]}]}}))`);
  await app.run('cloudLoadProgress(2)');await app.nodes.get('backupBtn').onclick();
  const backup=JSON.parse(app.nodes.get('exportText').value);assert.equal(backup.sessions.length,66);assert.ok(backup.sessions.some(s=>s.id==='hindi-other-level'));
  assert.ok(app.run('data.sessions.length')<=39);
  await app.nodes.get('allCsvBtn').onclick();const csv=app.nodes.get('exportText').value;
  assert.equal(csv.trim().split('\n').length,67);assert.match(csv,/"hi-IN","2","diagnostic"/);assert.match(csv,/2026-01-01T00:00:00.000Z/);
});
test('learner rename and backup import preserve unloaded history and other learners',async()=>{
  const {app}=await setup();await addLearner(app);await seedHistory(app);
  const first=app.run('selected');await addLearner(app,'Other');await complete(app);
  app.run('selected='+JSON.stringify(first)+';render()');await app.run('cloudState.progressPromise');
  app.nodes.get('renameCode').value='Renamed';app.nodes.get('renameForm').onsubmit({preventDefault(){}});await app.run('cloudState.writeQueue');
  let snapshot=await app.run("cloudRequest(cloudPath('/data'))");assert.equal(snapshot.data.sessions.length,66);assert.equal(snapshot.data.learners.find(l=>l.id===first).code,'Renamed');
  app.run('importBackupText(JSON.stringify({version:2,learners:[],sessions:[]}))');await app.run('cloudState.writeQueue');
  snapshot=await app.run("cloudRequest(cloudPath('/data'))");assert.equal(snapshot.data.sessions.length,66);assert.equal(snapshot.data.learners.length,2);
});
test('out-of-order progress responses cannot replace a newly selected learner',async()=>{
  const {app}=await setup();await addLearner(app,'First');await complete(app);const first=app.run('selected');await addLearner(app,'Second');const second=app.run('selected');
  const held=app.holdRequest('/learners/'+first+'/progress');app.run('selected='+JSON.stringify(first)+';render()');const earlier=app.run('cloudState.progressPromise');await held.reached;
  app.run('selected='+JSON.stringify(second)+';render()');await app.run('cloudState.progressPromise');held.release();await earlier;
  assert.equal(app.run('selected'),second);assert.equal(app.run('cloudState.progress.context.learner'),second);assert.equal(app.run('cloudState.progress.total'),0);
  assert.doesNotMatch(app.nodes.get('workspace').innerHTML,/Recent activity/);
});
test('history refreshes safely after another device saves and repeated exposure survives pagination',async()=>{
  const {DB,app}=await setup();await addLearner(app);await seedHistory(app);const other=await client(DB);
  await complete(other);await app.run('cloudLoadProgress(1)');assert.equal(app.run('cloudState.progress.history.page'),0);assert.equal(app.run('cloudState.progress.total'),66);
  assert.match(app.nodes.get('toast').textContent,/first history page/);
  await app.run('cloudLoadProgress(3)');app.run("startRun('diagnostic','writing')");assert.equal(app.run('run.repeated'),true);
});
test('a failed progress refresh never mislabels an acknowledged result as unsaved',async()=>{
  const {DB,app}=await setup();await addLearner(app);app.run("startRun('diagnostic','sounds');run.chosen=2;nextTask();run.chosen=2");
  const held=app.holdRequest('/progress?');app.run('nextTask()');await held.reached;
  // The result transaction has committed. Only the subsequent read now fails.
  DB.sqlite.prepare('DELETE FROM memberships WHERE workspace_id=? AND user_id=?').run(app.run('cloudState.workspaceId'),owner.id);
  held.release();await app.run('cloudState.writeQueue');await app.run('cloudState.draftQueue');
  assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n,1);assert.equal(app.run('cloudState.recoveries.size'),0);assert.equal(app.run('recordsUnsaved'),false);
  assert.equal(app.run('cloudState.status'),'error');assert.equal(app.nodes.get('activityDialog').open,false);
});

test('hosted file and paste imports apply the 12 MiB envelope limit in UTF-8 bytes',async()=>{
  const {app}=await setup(),raw='अ'.repeat(4*1024*1024+1);assert.ok(raw.length<12*1024*1024);
  app.nodes.get('pastedBackup').value=raw;app.nodes.get('applyPastedBackup').onclick();assert.match(app.nodes.get('importStatus').textContent,/12 MiB or smaller/);
  let read=false;await app.nodes.get('importFile').onchange({target:{value:'large.json',files:[{size:Buffer.byteLength(raw),text:async()=>{read=true;return raw}}]}});
  assert.equal(read,false);assert.match(app.nodes.get('importStatus').textContent,/12 MiB or smaller/);
});

async function enableDevice(app){app.run('cloudAccount()');const box=app.nodes.get('deviceRecoveryEnabled');box.checked=true;await box.onchange();await app.run('cloudState.draftQueue');assert.equal(app.run('cloudState.device.enabled()'),true)}

test('device recovery defaults off and account controls enable it without exposing the key',async()=>{
  const {DB,app}=await setup();await addLearner(app);assert.equal(app.run('cloudState.device.enabled()'),false);
  assert.equal(DB.sqlite.prepare('SELECT device_recovery_key FROM users WHERE id=?').get(owner.id).device_recovery_key,null);
  await enableDevice(app);assert.match(app.nodes.get('deviceRecoveryStatus').textContent,/is on/);
  const key=DB.sqlite.prepare('SELECT device_recovery_key FROM users WHERE id=?').get(owner.id).device_recovery_key;
  assert.ok(!JSON.stringify([...app.store]).includes(key));assert.ok(!app.nodes.get('accountContent').innerHTML.includes(key));
});
test('a completed offline result survives reload and automatically saves once after reconnecting',async()=>{
  const {DB,app}=await setup();await addLearner(app);await enableDevice(app);app.transport.fail=true;await complete(app);
  assert.equal(app.run('cloudState.progress.total'),0);assert.equal(app.run('cloudState.device.count()'),1);assert.equal(app.run('[...cloudState.recoveries.values()][0].localStored'),true);
  assert.equal(app.run('[...cloudState.recoveries.values()][0].stored'),false);assert.equal(app.run('cloudHasTransientWork()'),false);assert.match(app.nodes.get('cloudSaveStatus').textContent,/saved on this device/);
  let warned=false;for(const fn of app.windowEvents.get('beforeunload')||[])fn({preventDefault(){warned=true}});assert.equal(warned,false);
  const reloaded=await client(DB,owner,undefined,app.store);
  assert.equal(reloaded.run('cloudState.progress.total'),1);assert.equal(reloaded.run('cloudState.recoveries.size'),0);assert.equal(reloaded.run('cloudState.device.count()'),0);
  assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n,1);assert.equal(reloaded.run('hasUnsaved'),false);
});
test('a different adult sharing the browser cannot open or automatically upload another account’s device results',async()=>{
  const {DB,app}=await setup();await addLearner(app);await enableDevice(app);app.transport.fail=true;await complete(app);
  const other=await client(DB,parent,undefined,app.store);assert.equal(other.run('cloudState.status'),'setup');assert.equal(other.run('data.sessions.length'),0);assert.equal(other.run('cloudState.recoveries.size'),0);
  other.run('cloudAccount()');assert.match(other.nodes.get('accountContent').innerHTML,/0 device copies/);
  assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n,0);assert.equal(app.run('cloudState.device.count()'),1);
});
test('learner reassignment hides retained device recovery and prevents upload until access is restored',async()=>{
  const {DB,app}=await setup();await addLearner(app,'Assigned');const first=app.run('selected');await addLearner(app,'Other');const second=app.run('selected');
  const link=await app.run("cloudRequest(cloudPath('/invitations'),'POST',{email:'parent@example.test',role:'parent',learnerIds:[data.learners[0].id]})");
  const token=new URL(link.url).searchParams.get('invite'),p=await client(DB,parent);await p.run("cloudRequest('/invitations/"+token+"','POST',{})");await p.run('cloudInit()');await enableDevice(p);p.transport.fail=true;await complete(p);
  await app.run("cloudRequest(cloudPath('/members/ui-parent'),'PATCH',{role:'parent',status:'active',learnerIds:["+JSON.stringify(second)+"]})");
  const reloaded=await client(DB,parent,undefined,p.store);assert.equal(reloaded.run('learner().code'),'Other');assert.equal(reloaded.run('cloudState.recoveries.size'),0);assert.equal(reloaded.run('cloudState.device.count()'),1);assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n,0);
  await app.run("cloudRequest(cloudPath('/members/ui-parent'),'PATCH',{role:'parent',status:'active',learnerIds:["+JSON.stringify(first)+"]})");
  const restored=await client(DB,parent,undefined,p.store);assert.equal(restored.run('cloudState.progress.total'),1);assert.equal(restored.run('cloudState.device.count()'),0);
});
test('blocked device storage preserves tab-only work and never claims it survived a reload',async()=>{
  const {app}=await setup();await addLearner(app);await enableDevice(app);app.context.localStorage.setItem=()=>{throw Error('Storage blocked')};app.transport.fail=true;await complete(app);
  assert.equal(app.run('cloudState.device.count()'),0);assert.equal(app.run('!![...cloudState.recoveries.values()][0].localStored'),false);assert.equal(app.run('cloudHasTransientWork()'),true);
  app.run('dataDialog()');assert.match(app.nodes.get('cloudRecoveryList').innerHTML,/Only in this tab/);assert.match(app.nodes.get('cloudRecoveryList').innerHTML,/Storage blocked/);
  let warned=false;for(const fn of app.windowEvents.get('beforeunload')||[])fn({preventDefault(){warned=true}});assert.equal(warned,true);
});
test('online events retry queued results once and remove the encrypted copy after acknowledgement',async()=>{
  const {DB,app}=await setup();await addLearner(app);await enableDevice(app);app.context.navigator.onLine=false;await complete(app);assert.equal(app.run('cloudState.device.count()'),1);
  const before=app.transport.requests.length;app.context.navigator.onLine=true;
  for(let i=0;i<2;i++)for(const fn of app.windowEvents.get('online')||[])fn();await app.run('cloudState.syncPromise');await app.run('cloudState.draftQueue');
  assert.equal(app.run('cloudState.progress.total'),1);assert.equal(app.run('cloudState.device.count()'),0);
  assert.equal(app.transport.requests.slice(before).filter(r=>r.path.includes('/sessions/')&&r.method==='PUT').length,1);assert.equal(DB.sqlite.prepare('SELECT count(*) AS n FROM sessions').get().n,1);
});
test('request deadlines abort stalled connections and release the request for retry',async()=>{
  const {app}=await setup(),original=app.context.fetch,timers=new Map();let id=0,aborted=false;
  app.context.setTimeout=(fn,ms)=>{if(ms===20000)timers.set(++id,fn);return id};app.context.clearTimeout=id=>timers.delete(id);
  app.context.fetch=(_path,init)=>new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'))})});
  const pending=app.run("cloudRequest('/me')").catch(e=>e);[...timers.values()][0]();const error=await pending;
  assert.equal(error.code,'NETWORK_TIMEOUT');assert.equal(aborted,true);assert.equal(timers.size,0);
  app.context.fetch=original;assert.ok((await app.run("cloudRequest('/me')")).user);assert.equal(timers.size,0);
});
test('turning off recovery with unsent copies requires explicit clearing and retains visible work',async()=>{
  const {app}=await setup();await addLearner(app);await enableDevice(app);app.transport.fail=true;await complete(app);app.run('cloudAccount()');
  const box=app.nodes.get('deviceRecoveryEnabled');box.checked=false;await box.onchange();assert.equal(app.run('cloudState.device.enabled()'),true);assert.match(app.nodes.get('deviceRecoveryStatus').textContent,/Save or clear/);
  app.context.confirm=()=>false;await app.run('cloudClearDevice()');assert.equal(app.run('cloudState.device.count()'),1);
  app.context.confirm=()=>true;await app.run('cloudClearDevice()');assert.equal(app.run('cloudState.device.count()'),0);assert.equal(app.run('cloudState.device.enabled()'),false);assert.equal(app.run('cloudState.recoveries.size'),1);assert.equal(app.run('cloudHasTransientWork()'),true);
});

test('removing a device copy withdraws the saved-on-device status and restores the close warning',async()=>{
  const {app}=await setup();await addLearner(app);await enableDevice(app);app.context.navigator.onLine=false;await complete(app);
  assert.equal(app.run('cloudHasTransientWork()'),false);const key=[...app.store.keys()].find(k=>k.includes(':result:'));app.store.delete(key);
  for(const fn of app.windowEvents.get('storage')||[])fn({key});
  assert.equal(app.run('cloudHasTransientWork()'),true);assert.match(app.nodes.get('cloudSaveStatus').textContent,/keep this tab open/);
  let warned=false;for(const fn of app.windowEvents.get('beforeunload')||[])fn({preventDefault(){warned=true}});assert.equal(warned,true);
});

test('a changed sign-in cannot encrypt an old tab’s work with another adult’s recovery key',async()=>{
  const {DB,app}=await setup();await addLearner(app);app.run('cloudAccount()');app.transport.identity=parent;
  const box=app.nodes.get('deviceRecoveryEnabled');box.checked=true;await box.onchange();
  assert.equal(app.run('cloudState.status'),'error');assert.equal(app.run('data.learners.length'),0);assert.equal(app.run('cloudState.device.enabled()'),false);assert.equal(app.run('cloudState.device.count()'),0);
  assert.equal(DB.sqlite.prepare('SELECT device_recovery_key FROM users WHERE id=?').get(owner.id).device_recovery_key,null);
  assert.match(app.nodes.get('workspace').innerHTML,/account changed/);
});
