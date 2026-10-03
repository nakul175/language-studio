import { authenticatedUser, authLinks } from './auth.mjs';
import { validateBackup, validSession, codeKey, compareSessions } from '../src/engine.mjs';
import { makeBank, DOMAINS } from '../src/curriculum.mjs';
import { learningAi, LearningAiError } from './learning-ai.mjs';
import {openLearning} from './open-learning.mjs';

class HttpError extends Error { constructor(status,message,code){super(message);this.status=status;this.code=code} }
const fail=(status,message,code)=>{throw new HttpError(status,message,code)};
const id=()=>crypto.randomUUID();
const roles=['admin','teacher','parent'];
const validId=v=>typeof v==='string'&&v.trim().length>0&&v.length<=120;
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const one=(db,sql,...args)=>stmt(db,sql,...args).first();
const rows=async(db,sql,...args)=>(await stmt(db,sql,...args).all()).results;
const change=r=>Number(r?.meta?.changes||0);

async function body(request,max=10*1024*1024){
  const origin=request.headers.get('Origin');
  if(origin!==new URL(request.url).origin||request.headers.get('X-Language-Studio')!=='1'||!request.headers.get('Content-Type')?.startsWith('application/json'))fail(403,'This request must come from Language Studio.');
  if(Number(request.headers.get('Content-Length'))>max)fail(413,'This request is too large.');
  const reader=request.body?.getReader();if(!reader)fail(400,'A JSON request is required.');
  let size=0;const parts=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();fail(413,'This request is too large.')}parts.push(value)}
  const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length}
  try{const parsed=JSON.parse(new TextDecoder().decode(bytes));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();return parsed}catch{fail(400,'A valid JSON object is required.')}
}

async function member(db,w,user,admin=false){
  const m=await one(db,'SELECT m.role,w.name,w.owner_id,w.revision FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=? AND m.user_id=? AND m.status=\'active\'',w,user.id);
  if(!m)fail(403,'You no longer have access to this workspace.');
  if(admin&&m.role!=='admin')fail(403,'Only a workspace administrator can manage users.');
  return m;
}
const visibleSQL="(m.role IN ('admin','teacher') OR EXISTS (SELECT 1 FROM learner_access a WHERE a.workspace_id=l.workspace_id AND a.user_id=m.user_id AND a.learner_id=l.id))";
async function snapshot(db,w,user,compact=false){
  // Read membership and data in one D1 batch so access changes cannot split the snapshot.
  const result=await db.batch([
    stmt(db,"SELECT m.role,w.name,w.owner_id,w.revision FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=? AND m.user_id=? AND m.status='active'",w,user.id),
    stmt(db,`SELECT l.id,l.code FROM learners l JOIN memberships m ON m.workspace_id=l.workspace_id AND m.user_id=? AND m.status='active' WHERE l.workspace_id=? AND ${visibleSQL} ORDER BY l.created_at,l.id`,user.id,w),
    stmt(db,`SELECT s.payload FROM sessions s JOIN learners l ON l.workspace_id=s.workspace_id AND l.id=s.learner_id JOIN memberships m ON m.workspace_id=l.workspace_id AND m.user_id=? AND m.status='active' WHERE l.workspace_id=? AND ${visibleSQL} ${compact?'AND 0':''} ORDER BY s.at,s.id`,user.id,w),
    stmt(db,`SELECT d.payload,d.revision FROM drafts d JOIN learners l ON l.workspace_id=d.workspace_id AND l.id=d.learner_id JOIN memberships m ON m.workspace_id=l.workspace_id AND m.user_id=d.user_id AND m.status='active' WHERE d.workspace_id=? AND d.user_id=? AND ${visibleSQL}`,w,user.id),
    stmt(db,`SELECT r.payload FROM recovery_results r JOIN learners l ON l.workspace_id=r.workspace_id AND l.id=r.learner_id JOIN memberships m ON m.workspace_id=l.workspace_id AND m.user_id=r.user_id AND m.status='active' WHERE r.workspace_id=? AND r.user_id=? AND ${visibleSQL} ORDER BY r.created_at,r.id`,w,user.id),
    stmt(db,'SELECT count(*) AS n,coalesce(sum(length(CAST(payload AS BLOB))),0) AS bytes FROM sessions WHERE workspace_id=?',w),
    stmt(db,`SELECT count(*) AS n FROM sessions s JOIN learners l ON l.workspace_id=s.workspace_id AND l.id=s.learner_id JOIN memberships m ON m.workspace_id=l.workspace_id AND m.user_id=? AND m.status='active' WHERE l.workspace_id=? AND ${visibleSQL}`,user.id,w)
  ]);
  const m=result[0].results[0];if(!m)fail(403,'You no longer have access to this workspace.');
  const d=result[3].results[0];
  const capacity=result[5].results[0];
  return {data:{version:2,learners:result[1].results,sessions:result[2].results.map(r=>JSON.parse(r.payload))},total:result[6].results[0].n,revision:m.revision,role:m.role,name:m.name,ownerId:m.owner_id,draft:d?{...JSON.parse(d.payload),revision:d.revision}:null,recovery:result[4].results.map(r=>JSON.parse(r.payload)),capacity:{near:capacity.n>=9000||capacity.bytes>=9*1024*1024,full:capacity.n>=10000||capacity.bytes>=10*1024*1024}};
}

function mutation(db,w,user,revision,admin=false){
  const nonce=id(),gate='EXISTS (SELECT 1 FROM workspaces WHERE id=? AND last_mutation=?)';
  const queries=[stmt(db,`UPDATE workspaces SET revision=revision+1,last_mutation=? WHERE id=? AND revision=? AND EXISTS (SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=? AND status='active' ${admin?"AND role='admin'":''})`,nonce,w,revision,w,user.id)];
  return {queries,gate,args:[w,nonce],add(sql,...args){queries.push(stmt(db,sql,...args,w,nonce))},audit(action,detail){queries.push(stmt(db,`INSERT INTO audit_events SELECT ?,?,?,?,?,? WHERE ${gate}`,id(),w,user.id,action,JSON.stringify(detail),Date.now(),w,nonce))},async commit(){const r=await db.batch(queries);if(!change(r[0]))fail(409,'This workspace changed. Refresh and try again.')}};
}
function chunks(values){
  const all=[];let chunk=[],size=0;
  for(const v of values){const n=new TextEncoder().encode(JSON.stringify(v)).length;if(size+n>450000&&chunk.length){all.push(chunk);chunk=[];size=0}chunk.push(v);size+=n}
  if(chunk.length)all.push(chunk);return all;
}
async function saveData(db,w,user,b){
  if(Array.isArray(b.data?.learners)&&b.data.learners.length>500||Array.isArray(b.data?.sessions)&&b.data.sessions.length>10000)fail(400,'Workspace limit reached: 500 learners or 10,000 completed activities.','WORKSPACE_CAPACITY');
  if(!validId(b.operationId)||!Number.isSafeInteger(b.revision)||!validateBackup(b.data))fail(400,'Invalid learner records or scores.');
  const digest=await hash(JSON.stringify(b.data));
  await member(db,w,user);
  const receipt=await one(db,'SELECT user_id,digest FROM operations WHERE workspace_id=? AND id=?',w,b.operationId);
  if(receipt){if(receipt.user_id!==user.id||receipt.digest!==digest)fail(409,'This save identifier was already used.');return snapshot(db,w,user)}
  const current=await snapshot(db,w,user);
  if(current.revision!==b.revision)fail(409,'Another user saved changes. Refreshing your records will preserve their work.');
  const before=new Map(current.data.learners.map(l=>[l.id,l])),after=new Map(b.data.learners.map(l=>[l.id,l]));
  const removed=current.data.learners.filter(l=>!after.has(l.id)).map(l=>l.id);
  const added=b.data.learners.filter(l=>!before.has(l.id));
  const renamed=b.data.learners.filter(l=>before.has(l.id)&&before.get(l.id).code!==l.code);
  if(current.role==='parent'&&(removed.length||added.length||renamed.length))fail(403,'Parents can save activities for assigned learners. Ask your administrator to manage learners.');
  if(removed.length&&current.role!=='admin')fail(403,'Only administrators can delete learners and their records.');
  const existing=new Map(current.data.sessions.map(s=>[s.id,s])),incomingIds=new Set(b.data.sessions.map(s=>s.id));
  if(current.data.sessions.some(s=>after.has(s.learner)&&!incomingIds.has(s.id)))fail(400,'Completed activities cannot be removed individually.');
  for(const s of b.data.sessions)if(existing.has(s.id)&&JSON.stringify(existing.get(s.id))!==JSON.stringify(s))fail(409,'A completed result cannot be overwritten.');
  const newSessions=b.data.sessions.filter(s=>!existing.has(s.id));
  // Counts are workspace-wide, even when a parent sees only a subset.
  const counts=await one(db,'SELECT (SELECT count(*) FROM learners WHERE workspace_id=?) AS learners,(SELECT count(*) FROM sessions WHERE workspace_id=?) AS sessions,(SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM sessions WHERE workspace_id=?) AS bytes',w,w,w);
  const deletedSessions=current.data.sessions.filter(s=>removed.includes(s.learner)).length;
  if(counts.learners+added.length-removed.length>500||counts.sessions+newSessions.length-deletedSessions>10000)fail(400,'Workspace limit reached: 500 learners or 10,000 completed activities. Export records before continuing.','WORKSPACE_CAPACITY');
  const byteSize=value=>new TextEncoder().encode(JSON.stringify(value)).length;
  if(counts.bytes+newSessions.reduce((n,s)=>n+byteSize(s),0)-current.data.sessions.filter(s=>removed.includes(s.learner)).reduce((n,s)=>n+byteSize(s),0)>10*1024*1024)fail(400,'This workspace has reached its 10 MiB record capacity. Export a backup and start another learning space.','WORKSPACE_CAPACITY');
  const tx=mutation(db,w,user,b.revision);
  if(removed.length)tx.add(`DELETE FROM learners WHERE workspace_id=? AND id IN (SELECT value FROM json_each(?)) AND ${tx.gate}`,w,JSON.stringify(removed));
  // Temporary keys allow two learner codes to be swapped without transient uniqueness failures.
  for(const list of chunks(renamed))tx.add(`UPDATE learners SET code_key='reserved:'||?||':'||id WHERE workspace_id=? AND id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND ${tx.gate}`,id(),w,JSON.stringify(list));
  for(const list of chunks([...added,...renamed].map(l=>({id:l.id,code:l.code.trim(),key:codeKey(l.code)}))))tx.add(`INSERT INTO learners (workspace_id,id,code,code_key,created_by,created_at,updated_at) SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.code'),json_extract(value,'$.key'),?,?,? FROM json_each(?) WHERE ${tx.gate} ON CONFLICT(workspace_id,id) DO UPDATE SET code=excluded.code,code_key=excluded.code_key,updated_at=excluded.updated_at`,w,user.id,Date.now(),Date.now(),JSON.stringify(list));
  for(const list of chunks(newSessions))tx.add(`INSERT INTO sessions (workspace_id,id,learner_id,payload,lang,level,mode,at,created_at,created_by) SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.learner'),value,json_extract(value,'$.lang'),json_extract(value,'$.level'),json_extract(value,'$.mode'),json_extract(value,'$.at'),?,? FROM json_each(?) WHERE ${tx.gate}`,w,Date.now(),user.id,JSON.stringify(list));
  tx.add(`DELETE FROM drafts WHERE workspace_id=? AND EXISTS (SELECT 1 FROM sessions s WHERE s.workspace_id=drafts.workspace_id AND s.id=drafts.id) AND ${tx.gate}`,w);
  tx.add(`DELETE FROM recovery_results WHERE workspace_id=? AND EXISTS (SELECT 1 FROM sessions s WHERE s.workspace_id=recovery_results.workspace_id AND s.id=recovery_results.id) AND ${tx.gate}`,w);
  tx.add(`INSERT INTO operations SELECT ?,?,?,?,? WHERE ${tx.gate}`,w,b.operationId,user.id,digest,Date.now());
  tx.audit('records.saved',{addedLearners:added.length,renamedLearners:renamed.length,deletedLearners:removed.length,addedSessions:newSessions.length});
  try{await tx.commit()}catch(e){if(e instanceof HttpError)throw e;if(/UNIQUE|constraint/i.test(e.message))fail(409,'A learner code or activity ID is already in use. Refresh and try again.');throw e}
  return snapshot(db,w,user);
}

// Keep completed work separate from the bounded history until final insertion.
// Authorization and buffer limits are rechecked in the same write statement.
async function recoveryResult(db,w,user,rid,b,remove){
  await member(db,w,user);
  if(!validId(rid))fail(400,'Invalid result identifier.');
  const access=`SELECT 1 FROM learners l JOIN memberships m ON m.workspace_id=l.workspace_id AND m.user_id=? AND m.status='active' WHERE l.workspace_id=? AND l.id=? AND ${visibleSQL}`;
  if(remove){
    const pending=await one(db,'SELECT learner_id FROM recovery_results WHERE workspace_id=? AND user_id=? AND id=?',w,user.id,rid);
    if(!pending)return {ok:true};
    if(!await one(db,access,user.id,w,pending.learner_id))fail(403,'You no longer have access to this learner.');
    await stmt(db,`DELETE FROM recovery_results WHERE workspace_id=? AND user_id=? AND id=? AND EXISTS (${access})`,w,user.id,rid,user.id,w,pending.learner_id).run();
    return {ok:true};
  }
  const s=b.session;if(!validSession(s)||s.id!==rid)fail(400,'This result failed validation.');
  if(!await one(db,access,user.id,w,s.learner))fail(403,'You no longer have access to this learner.');
  const committed=await one(db,'SELECT id FROM sessions WHERE workspace_id=? AND learner_id=? AND id=?',w,s.learner,rid);
  if(committed)return {stored:false,completed:true};
  const payload=JSON.stringify(s),existing=await one(db,'SELECT payload FROM recovery_results WHERE workspace_id=? AND user_id=? AND id=?',w,user.id,rid);
  if(existing){if(existing.payload!==payload)fail(409,'A different result already uses this activity identifier.');return {stored:true}}
  const q=stmt(db,`INSERT INTO recovery_results (workspace_id,user_id,id,learner_id,payload,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (${access}) AND (SELECT count(*) FROM recovery_results WHERE workspace_id=? AND user_id=?)<10 AND (SELECT count(*) FROM recovery_results WHERE workspace_id=?)<100 AND NOT EXISTS (SELECT 1 FROM sessions WHERE workspace_id=? AND id=?) ON CONFLICT(workspace_id,user_id,id) DO NOTHING`,w,user.id,rid,s.learner,payload,Date.now(),user.id,w,s.learner,w,user.id,w,w,rid);
  const result=await db.batch([q,stmt(db,`DELETE FROM drafts WHERE workspace_id=? AND user_id=? AND id=? AND EXISTS (SELECT 1 FROM recovery_results WHERE workspace_id=? AND user_id=? AND id=?)`,w,user.id,rid,w,user.id,rid)]);
  if(!change(result[0])){
    const same=await one(db,'SELECT payload FROM recovery_results WHERE workspace_id=? AND user_id=? AND id=?',w,user.id,rid);
    if(same?.payload===payload)return {stored:true};
    fail(409,'Recovery could not be stored. Review existing recovery results or refresh your access; keep this tab open.','RECOVERY_UNAVAILABLE');
  }
  return {stored:true};
}

// Result IDs are immutable idempotency keys. This transaction does not depend on
// a client's workspace revision, so independent completions can both succeed.
async function appendSession(db,w,user,rid,b){
  const s=b.session;if(!validSession(s)||s.id!==rid)fail(400,'This result failed validation.');
  await member(db,w,user);
  const access=`SELECT 1 FROM learners l JOIN memberships m ON m.workspace_id=l.workspace_id AND m.user_id=? AND m.status='active' WHERE l.workspace_id=? AND l.id=? AND ${visibleSQL}`;
  if(!await one(db,access,user.id,w,s.learner))fail(403,'You no longer have access to this learner.');
  const payload=JSON.stringify(s),nonce=id(),gate='EXISTS (SELECT 1 FROM workspaces WHERE id=? AND last_mutation=?)';
  const result=await db.batch([
    stmt(db,`UPDATE workspaces SET revision=revision+1,last_mutation=? WHERE id=? AND EXISTS (${access}) AND NOT EXISTS (SELECT 1 FROM sessions WHERE workspace_id=? AND id=?) AND (SELECT count(*) FROM sessions WHERE workspace_id=?)<10000 AND (SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) FROM sessions WHERE workspace_id=?)+?<=10485760`,nonce,w,user.id,w,s.learner,w,rid,w,w,new TextEncoder().encode(payload).length),
    stmt(db,`INSERT INTO sessions (workspace_id,id,learner_id,payload,lang,level,mode,at,created_at,created_by) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${gate}`,w,rid,s.learner,payload,s.lang,s.level,s.mode,s.at,Date.now(),user.id,w,nonce),
    stmt(db,`DELETE FROM drafts WHERE workspace_id=? AND id=? AND ${gate}`,w,rid,w,nonce),
    stmt(db,`DELETE FROM recovery_results WHERE workspace_id=? AND id=? AND ${gate}`,w,rid,w,nonce),
    stmt(db,`INSERT INTO audit_events SELECT ?,?,?,?,?,? WHERE ${gate}`,id(),w,user.id,'result.saved',JSON.stringify({sessionId:rid,learnerId:s.learner}),Date.now(),w,nonce)
  ]);
  // Recheck access even on retries; a known ID must never bypass revocation.
  if(!await one(db,access,user.id,w,s.learner))fail(403,'You no longer have access to this learner.');
  const stored=await one(db,'SELECT payload FROM sessions WHERE workspace_id=? AND id=?',w,rid);
  if(stored){if(stored.payload!==payload)fail(409,'A different completed result already uses this activity identifier.');return {session:JSON.parse(stored.payload),duplicate:!change(result[0])}}
  fail(400,'This learning space has reached its record capacity. Your recovery copy can be exported or retried when space is available.','WORKSPACE_CAPACITY');
}

async function learnerProgress(db,w,user,lid,params){
  const lang=params.get('lang'),level=Number(params.get('level')),pageText=params.get('page')||'0',revisionText=params.get('revision');
  if(!validId(lid)||!['en-IN','hi-IN'].includes(lang)||![1,2,3].includes(level)||!/^\d{1,3}$/.test(pageText))fail(400,'Choose a valid learner, language, level and history page.');
  const page=Number(pageText),expected=revisionText===null?null:Number(revisionText);
  if(page>499||revisionText!==null&&(!/^\d+$/.test(revisionText)||!Number.isSafeInteger(expected))||page>0&&expected===null)fail(400,'Refresh progress before opening that history page.');
  const access=`FROM learners l JOIN memberships m ON m.workspace_id=l.workspace_id AND m.user_id=? AND m.status='active' JOIN workspaces w ON w.id=l.workspace_id WHERE l.workspace_id=? AND l.id=? AND ${visibleSQL}`;
  const scope=`FROM sessions s JOIN learners l ON l.workspace_id=s.workspace_id AND l.id=s.learner_id JOIN memberships m ON m.workspace_id=l.workspace_id AND m.user_id=? AND m.status='active' WHERE l.workspace_id=? AND l.id=? AND s.lang=? AND s.level=? AND ${visibleSQL}`;
  for(let attempt=0;attempt<3;attempt++){
    const initial=await db.batch([
      stmt(db,`SELECT w.revision ${access}`,user.id,w,lid),
      // Date.parse matches existing backups, including time zones and legacy
      // date strings. Only metadata is read for historical rows, not evidence.
      stmt(db,`SELECT s.id,s.at,s.mode,(SELECT json_group_array(DISTINCT json_extract(r.value,'$.domain')) FROM json_each(s.payload,'$.responses') r WHERE json_extract(r.value,'$.score') IS NOT NULL) AS domains ${scope}`,user.id,w,lid,lang,level),
      stmt(db,`SELECT DISTINCT json_extract(r.value,'$.item') AS item FROM sessions s JOIN json_each(s.payload,'$.responses') r JOIN learners l ON l.workspace_id=s.workspace_id AND l.id=s.learner_id JOIN memberships m ON m.workspace_id=l.workspace_id AND m.user_id=? AND m.status='active' WHERE l.workspace_id=? AND l.id=? AND s.lang=? AND s.level=? AND ${visibleSQL}`,user.id,w,lid,lang,level)
    ]);
    const revision=initial[0].results[0]?.revision;if(revision===undefined)fail(403,'You no longer have access to this learner.');
    if(expected!==null&&revision!==expected)fail(409,'New work is available. History has been refreshed to the first page.','HISTORY_CHANGED');
    const all=initial[1].results.sort((a,b)=>compareSessions(b,a));
    if(page>0&&page*20>=all.length)fail(400,'That history page is no longer available.');
    const evidence=new Set(),counts=new Map();
    for(const s of all){
      if(s.mode==='practice')continue;
      for(const domain of s.mode==='fluency'?['fluency']:JSON.parse(s.domains)){
        const count=counts.get(domain)||0;if(count<2)evidence.add(s.id);counts.set(domain,count+1);
      }
    }
    const history=all.slice(page*20,page*20+20).map(s=>s.id),recent=all.slice(0,3).map(s=>s.id),ids=[...new Set([...evidence,...history,...recent])];
    const final=await db.batch([
      stmt(db,`SELECT w.revision ${access}`,user.id,w,lid),
      stmt(db,`SELECT s.payload ${scope} AND s.id IN (SELECT value FROM json_each(?))`,user.id,w,lid,lang,level,JSON.stringify(ids))
    ]);
    const current=final[0].results[0]?.revision;if(current===undefined)fail(403,'You no longer have access to this learner.');
    if(current!==revision){if(expected!==null)fail(409,'New work is available. History has been refreshed to the first page.','HISTORY_CHANGED');continue}
    return {context:{learner:lid,lang,level},revision,sessions:final[1].results.map(r=>JSON.parse(r.payload)),total:all.length,practice:all.filter(s=>s.mode==='practice').length,fluency:counts.get('fluency')||0,seen:initial[2].results.map(r=>r.item),recent,history:{ids:history,page,pageSize:20,hasNext:(page+1)*20<all.length}};
  }
  fail(409,'Results are changing. Please refresh progress.','HISTORY_CHANGED');
}

function validDraft(d){
  if(!d||!validId(d.id)||!['en-IN','hi-IN'].includes(d.lang)||![1,2,3].includes(d.level)||!['practice','diagnostic','recheck'].includes(d.mode)||!['A','B'].includes(d.form)||!Number.isInteger(d.index)||!Array.isArray(d.answers)||!Array.isArray(d.heard)||d.heard.length>100)return false;
  if(d.domain&&(!DOMAINS.some(x=>x.id===d.domain)||d.domain==='fluency'))return false;
  const items=makeBank(d.lang,d.level,d.form).filter(q=>!d.domain||q.domain===d.domain),q=items[d.index];
  return !!q&&d.index>=0&&d.answers.length<=items.length&&d.answers.every((a,i)=>a?.item===items[i].id)&&
    (d.chosen===null||Number.isInteger(d.chosen)&&d.chosen>=0&&d.chosen<=(q.kind==='choice'?q.options.length-1:2))&&
    typeof d.supported==='boolean'&&typeof d.feedback==='boolean'&&(!d.feedback||d.mode==='practice')&&typeof d.note==='string'&&d.note.length<=500&&typeof d.evidence==='string'&&d.evidence.length<=2000&&d.heard.every(t=>items.some(q=>q.audio===t))&&
    validSession({id:d.id,learner:d.learner,lang:d.lang,level:d.level,mode:d.mode,domain:d.domain,form:d.form,at:new Date().toISOString(),responses:d.answers});
}
async function saveDraft(db,w,user,b,remove){
  const current=await snapshot(db,w,user,true);
  if((current.draft?.revision||null)!==(b.revision||null))fail(409,'The paused activity changed on another device. Your answers remain in this tab.');
  if(remove){
    if(current.draft?.id!==b.id)return {draft:current.draft};
    const r=await stmt(db,'DELETE FROM drafts WHERE workspace_id=? AND user_id=? AND id=? AND revision=?',w,user.id,b.id,b.revision).run();
    if(!change(r))fail(409,'The paused activity changed on another device.');return {draft:null};
  }
  const d=b.draft;
  if(!validDraft(d)||!current.data.learners.some(l=>l.id===d.learner))fail(400,'This paused activity is invalid or inaccessible.');
  if(await one(db,'SELECT id FROM sessions WHERE workspace_id=? AND id=?',w,d.id)||current.recovery.some(s=>s.id===d.id))fail(409,'This activity has already been completed.');
  const revision=id();
  const r=await stmt(db,`INSERT INTO drafts (workspace_id,user_id,id,learner_id,payload,revision,updated_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id=? AND revision=?) AND NOT EXISTS (SELECT 1 FROM sessions WHERE workspace_id=? AND id=?) AND NOT EXISTS (SELECT 1 FROM recovery_results WHERE workspace_id=? AND user_id=? AND id=?) AND (? IS NULL OR EXISTS (SELECT 1 FROM drafts WHERE workspace_id=? AND user_id=? AND revision=?)) ON CONFLICT(workspace_id,user_id) DO UPDATE SET id=excluded.id,learner_id=excluded.learner_id,payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at WHERE drafts.revision=?`,w,user.id,d.id,d.learner,JSON.stringify(d),revision,Date.now(),w,current.revision,w,d.id,w,user.id,d.id,b.revision||null,w,user.id,b.revision||null,b.revision||null).run();
  if(!change(r))fail(409,'The workspace or paused activity changed. Your answers remain in this tab.');
  return {draft:{...d,revision}};
}

async function assignments(db,w,role,ids){
  if(!roles.includes(role)||!Array.isArray(ids)||ids.length>500||new Set(ids).size!==ids.length||ids.some(x=>!validId(x)))fail(400,'Choose a valid role and learners.');
  if(role==='parent'&&!ids.length)fail(400,'Assign at least one learner to this parent.');
  if(role!=='parent')return [];
  const found=await rows(db,'SELECT id FROM learners WHERE workspace_id=? AND id IN (SELECT value FROM json_each(?))',w,JSON.stringify(ids));
  if(found.length!==ids.length)fail(400,'One of the selected learners is no longer available.');
  return ids;
}
async function manageMember(db,w,user,target,b){
  const m=await member(db,w,user,true);
  if(target===m.owner_id)fail(400,'The workspace owner must remain an active administrator.');
  const other=await one(db,'SELECT user_id FROM memberships WHERE workspace_id=? AND user_id=?',w,target);if(!other)fail(404,'User not found.');
  if(!['active','inactive'].includes(b.status))fail(400,'Choose a valid access status.');
  if(!roles.includes(b.role))fail(400,'Choose a valid role.');
  const ids=b.status==='inactive'?[]:await assignments(db,w,b.role,b.learnerIds||[]),tx=mutation(db,w,user,m.revision,true);
  tx.add(`UPDATE memberships SET role=?,status=?,access_version=access_version+1 WHERE workspace_id=? AND user_id=? AND ${tx.gate}`,b.role,b.status,w,target);
  // Access edits invalidate older grants, including pre-upgrade duplicate links.
  tx.add(`UPDATE invitations SET revoked_at=? WHERE workspace_id=? AND accepted_at IS NULL AND revoked_at IS NULL AND email IN (SELECT email FROM users WHERE id=? UNION SELECT email FROM invitations WHERE workspace_id=? AND accepted_by=?) AND ${tx.gate}`,Date.now(),w,target,w,target);
  if(b.status==='inactive'||b.role!=='admin')tx.add(`UPDATE invitations SET revoked_at=? WHERE workspace_id=? AND created_by=? AND accepted_at IS NULL AND revoked_at IS NULL AND ${tx.gate}`,Date.now(),w,target);
  tx.add(`DELETE FROM learner_access WHERE workspace_id=? AND user_id=? AND ${tx.gate}`,w,target);
  if(b.status==='active'&&ids.length)tx.add(`INSERT INTO learner_access SELECT ?,?,value FROM json_each(?) WHERE ${tx.gate}`,w,target,JSON.stringify(ids));
  tx.add(`DELETE FROM drafts WHERE workspace_id=? AND user_id=? AND ${tx.gate}`,w,target);
  tx.audit('member.updated',{target,role:b.role,status:b.status,learnerIds:ids});await tx.commit();return {ok:true};
}
async function createInvite(db,w,user,b,origin){
  const m=await member(db,w,user,true),email=String(b.email||'').trim().toLowerCase();
  if(email.length>320||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Enter a valid email address.');
  const ids=await assignments(db,w,b.role,b.learnerIds||[]);
  const existing=await one(db,'SELECT m.user_id,m.status,m.access_version FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND u.email=?',w,email);
  if(existing?.status==='active')fail(409,'This person already has access. Edit their role in the user list.');
  const count=await one(db,'SELECT count(*) AS n FROM invitations WHERE workspace_id=? AND email<>? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?',w,email,Date.now());if(count.n>=100)fail(400,'Revoke older invitations before creating more.');
  const token=[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const iid=id(),expires=Date.now()+7*86400000,tx=mutation(db,w,user,m.revision,true);
  tx.add(`UPDATE invitations SET revoked_at=? WHERE workspace_id=? AND email=? AND accepted_at IS NULL AND revoked_at IS NULL AND ${tx.gate}`,Date.now(),w,email);
  tx.add(`INSERT INTO invitations (id,workspace_id,email,role,learner_ids,token_hash,created_by,created_at,expires_at,recipient_version) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${tx.gate}`,iid,w,email,b.role,JSON.stringify(ids),await hash(token),user.id,Date.now(),expires,existing?.access_version??null);
  tx.audit('invitation.created',{invitationId:iid,role:b.role});await tx.commit();
  return {id:iid,url:origin+'/?invite='+token,expiresAt:expires};
}
async function invitation(db,token,user,accept){
  if(!/^[a-f0-9]{64}$/.test(token))fail(404,'Invitation not found.');
  const i=await one(db,'SELECT i.*,w.name,w.owner_id,w.revision FROM invitations i JOIN workspaces w ON w.id=i.workspace_id WHERE i.token_hash=?',await hash(token));
  if(!i||i.revoked_at||i.accepted_at||i.expires_at<=Date.now())fail(410,'This invitation has expired or is no longer available. Ask the administrator for a new link.');
  if(i.email!==user.email)fail(403,'Sign in with the email address this invitation was sent to.');
  const issuer=await one(db,"SELECT role FROM memberships WHERE workspace_id=? AND user_id=? AND status='active' AND role='admin'",i.workspace_id,i.created_by);
  if(!issuer)fail(410,'The person who created this invitation can no longer grant access.');
  const exists=await one(db,'SELECT status,access_version FROM memberships WHERE workspace_id=? AND user_id=?',i.workspace_id,user.id);
  if(exists?.status==='active')fail(409,'You already have access to this workspace.');
  if((exists?.access_version??null)!==i.recipient_version)fail(410,'Access changed after this invitation was issued. Ask the administrator for a new link.');
  if(!accept)return {workspaceName:i.name,role:i.role,expiresAt:i.expires_at};
  const ids=await assignments(db,i.workspace_id,i.role,JSON.parse(i.learner_ids));
  const nonce=id(),gate='EXISTS (SELECT 1 FROM workspaces WHERE id=? AND last_mutation=?)',now=Date.now();
  const queries=[stmt(db,`UPDATE workspaces SET revision=revision+1,last_mutation=? WHERE id=? AND revision=? AND EXISTS (SELECT 1 FROM invitations WHERE id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>?)`,nonce,i.workspace_id,i.revision,i.id,now),
    stmt(db,`INSERT INTO memberships (workspace_id,user_id,role,status,joined_at) SELECT ?,?,?,'active',? WHERE ${gate} ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role,status='active',joined_at=excluded.joined_at,access_version=memberships.access_version+1`,i.workspace_id,user.id,i.role,now,i.workspace_id,nonce),
    stmt(db,`DELETE FROM learner_access WHERE workspace_id=? AND user_id=? AND ${gate}`,i.workspace_id,user.id,i.workspace_id,nonce)];
  if(ids.length)queries.push(stmt(db,`INSERT INTO learner_access SELECT ?,?,value FROM json_each(?) WHERE ${gate}`,i.workspace_id,user.id,JSON.stringify(ids),i.workspace_id,nonce));
  queries.push(stmt(db,`UPDATE invitations SET accepted_by=?,accepted_at=? WHERE id=? AND ${gate}`,user.id,now,i.id,i.workspace_id,nonce),
    stmt(db,`UPDATE invitations SET revoked_at=? WHERE workspace_id=? AND email=? AND id<>? AND accepted_at IS NULL AND revoked_at IS NULL AND ${gate}`,now,i.workspace_id,i.email,i.id,i.workspace_id,nonce),
    stmt(db,`INSERT INTO audit_events SELECT ?,?,?,?,?,? WHERE ${gate}`,id(),i.workspace_id,user.id,'invitation.accepted',JSON.stringify({invitationId:i.id}),now,i.workspace_id,nonce));
  const r=await db.batch(queries);if(!change(r[0]))fail(409,'The invitation changed. Please try again.');return {workspaceId:i.workspace_id};
}

export async function handleApi(request,env){
  try{
    const db=env.DB;if(!db)fail(503,'The database is not connected. Please try again later.');
    const url=new URL(request.url),p=url.pathname.split('/').filter(Boolean).map(decodeURIComponent),method=request.method;
    const user=authenticatedUser(request);
    if(p[1]==='me'&&method==='GET'&&!user)return json({user:null,...authLinks(url.searchParams.get('returnTo')||'/')});
    if(!user)fail(401,'Sign in to access your learning workspace.');
    const expectedUser=request.headers.get('X-Language-Studio-Account');
    if(expectedUser&&expectedUser!==user.id)fail(401,'The signed-in account changed. Reopen your workspace before continuing.','ACCOUNT_CHANGED');
    await stmt(db,'INSERT INTO users (id,email,name,created_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name',user.id,user.email,user.name,Date.now()).run();
    const aiRoute=p.length===6&&p[3]==='learners'&&p[5]==='ai-session';
    const b=['POST','PUT','PATCH','DELETE'].includes(method)?await body(request,aiRoute?6*1024*1024:p.at(-1)==='changes'?12*1024*1024:300000):null;
    if(p.length===3&&p[1]==='me'&&p[2]==='device-recovery-key'&&method==='POST'){
      if(Object.keys(b).length)fail(400,'This request does not accept account identifiers.');
      const key=[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
      await stmt(db,'UPDATE users SET device_recovery_key=? WHERE id=? AND device_recovery_key IS NULL',key,user.id).run();
      const saved=await one(db,'SELECT device_recovery_key FROM users WHERE id=?',user.id);
      return json({userId:user.id,key:saved.device_recovery_key});
    }
    if(p[1]==='me'&&method==='GET')return json({user,workspaces:await rows(db,"SELECT w.id,w.name,m.role FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=? AND m.status='active' ORDER BY w.created_at,w.id",user.id),...authLinks('/')});
    if(p[1]==='invitations'&&p.length===3&&['GET','POST'].includes(method))return json(await invitation(db,p[2],user,method==='POST'));
    if(p[1]!=='workspaces')fail(404,'Not found.');
    if(p.length===2&&method==='POST'){
      const name=typeof b.name==='string'?b.name.trim():'';if(!name||name.length>80)fail(400,'Enter a workspace name of 1–80 characters.');
      const count=await one(db,'SELECT count(*) AS n FROM workspaces WHERE owner_id=?',user.id);if(count.n>=10)fail(400,'You can own up to 10 workspaces.');
      const w=id();await db.batch([stmt(db,'INSERT INTO workspaces (id,name,owner_id,created_at) VALUES (?,?,?,?)',w,name,user.id,Date.now()),stmt(db,"INSERT INTO memberships (workspace_id,user_id,role,status,joined_at) VALUES (?,?,'admin','active',?)",w,user.id,Date.now())]);return json({workspaceId:w},201);
    }
    const w=p[2];if(!validId(w))fail(404,'Workspace not found.');
    if(p.length===6&&p[3]==='learners'&&p[5]==='open-session')return json(await openLearning(db,user,w,p[4],method,b));
    if(aiRoute){const result=await learningAi(db,env,user,w,p[4],method,b);return result instanceof Response?result:json(result)}
    if(p.length===4&&p[3]==='data'&&method==='GET')return json(await snapshot(db,w,user));
    if(p.length===4&&p[3]==='bootstrap'&&method==='GET')return json(await snapshot(db,w,user,true));
    if(p.length===5&&p[3]==='sessions'&&method==='PUT')return json(await appendSession(db,w,user,p[4],b));
    if(p.length===6&&p[3]==='learners'&&p[5]==='progress'&&method==='GET')return json(await learnerProgress(db,w,user,p[4],url.searchParams));
    if(p.length===4&&p[3]==='changes'&&method==='POST')return json(await saveData(db,w,user,b));
    if(p.length===4&&p[3]==='draft'&&['PUT','DELETE'].includes(method))return json(await saveDraft(db,w,user,b,method==='DELETE'));
    if(p.length===5&&p[3]==='recovery'&&['PUT','DELETE'].includes(method))return json(await recoveryResult(db,w,user,p[4],b,method==='DELETE'));
    const m=await member(db,w,user,true);
    if(p.length===4&&p[3]==='members'&&method==='GET'){
      const result=await db.batch([
        stmt(db,"SELECT u.id,u.name,u.email,m.role,m.status FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND EXISTS (SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=? AND role='admin' AND status='active') ORDER BY m.joined_at",w,w,user.id),
        stmt(db,"SELECT user_id,learner_id FROM learner_access WHERE workspace_id=? AND EXISTS (SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=? AND role='admin' AND status='active')",w,w,user.id),
        stmt(db,"SELECT id,email,role,learner_ids,expires_at FROM invitations WHERE workspace_id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>? AND EXISTS (SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=? AND role='admin' AND status='active') ORDER BY created_at DESC",w,Date.now(),w,user.id)
      ]);
      return json({ownerId:m.owner_id,members:result[0].results.map(u=>({...u,learnerIds:result[1].results.filter(a=>a.user_id===u.id).map(a=>a.learner_id)})),invitations:result[2].results.map(i=>({...i,learnerIds:JSON.parse(i.learner_ids),learner_ids:undefined}))});
    }
    if(p.length===5&&p[3]==='members'&&method==='PATCH')return json(await manageMember(db,w,user,p[4],b));
    if(p.length===4&&p[3]==='invitations'&&method==='POST')return json(await createInvite(db,w,user,b,url.origin),201);
    if(p.length===5&&p[3]==='invitations'&&method==='DELETE'){
      const tx=mutation(db,w,user,m.revision,true);tx.add(`UPDATE invitations SET revoked_at=? WHERE id=? AND workspace_id=? AND accepted_at IS NULL AND ${tx.gate}`,Date.now(),p[4],w);tx.audit('invitation.revoked',{invitationId:p[4]});await tx.commit();return json({ok:true});
    }
    fail(404,'Not found.');
  }catch(error){
    if(error instanceof HttpError||error instanceof LearningAiError)return json({error:error.message,...(error.code?{code:error.code}:{})},error.status);
    // Record only the failure category; never log identities, tokens or evidence.
    console.error('Language Studio API failure',error?.name||'Error');
    // Never return SQL, tokens, learner evidence, or stack traces to a visitor.
    return json({error:'The server could not save or load your work. Keep this tab open and try again.'},500);
  }
}
