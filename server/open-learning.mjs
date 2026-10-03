import {makeBank, domainById} from '../src/curriculum.mjs';
import {align, metrics} from '../src/reader/scoring.mjs';
import {LearningAiError} from './learning-ai.mjs';

export const OPEN_MODELS={assessment:'onnx-community/Qwen2.5-0.5B-Instruct',transcription:'onnx-community/whisper-base',voice:'Local system voice or eSpeak-NG 0.3.5',runtime:'Transformers.js 3.8.1'};
const skills=['fluency','decoding','vocabulary','comprehension','listening','speaking','writing'];
const access=`SELECT 1 FROM learners l JOIN memberships m ON m.workspace_id=l.workspace_id AND m.user_id=? AND m.status='active' WHERE l.workspace_id=? AND l.id=? AND (m.role IN ('admin','teacher') OR EXISTS (SELECT 1 FROM learner_access a WHERE a.workspace_id=l.workspace_id AND a.learner_id=l.id AND a.user_id=m.user_id))`;
const fail=(status,message)=>{throw new LearningAiError(status,message)};
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const first=(db,sql,...args)=>stmt(db,sql,...args).first();
const small=(s,max=2000)=>typeof s==='string'&&s.length<=max;
function activity(state,skill,practice=false){
  const bank=makeBank(state.lang,state.level,practice?(state.form==='A'?'B':'A'):state.form),q=bank.find(q=>q.domain===(skill==='fluency'?'comprehension':skill));
  if(skill==='fluency')return {skill,passage:q.passage,prompt:state.lang==='hi-IN'?'इस कहानी को ज़ोर से पढ़िए।':'Read this story aloud.',answerGuide:q.passage,hint:domainById('fluency').routine[0]};
  if(skill==='writing')return {skill,passage:'',prompt:state.lang==='hi-IN'?'अपनी पसंद की किसी चीज़ के बारे में एक वाक्य लिखिए।':'Write one sentence about something you like.',answerGuide:'A meaningful sentence about a familiar preference. Assess clarity and spelling from the written text, not handwriting.',hint:state.lang==='hi-IN'?'वाक्य ऐसे शुरू कर सकते हैं: मुझे … पसंद है।':'You can begin: I like …'};
  return {skill,passage:q.passage||q.audio||q.stimulus||'',prompt:q.prompt,answerGuide:q.kind==='choice'?q.options[q.answer]:q.rubric,hint:domainById(skill).routine[0]};
}
function report(state){
  const checked=state.answers.filter(a=>a.stage<state.checkCount),strengths=checked.filter(a=>a.score===2).map(a=>domainById(a.activity.skill).name),gaps=checked.filter(a=>a.score!==null&&a.score<2).map(a=>domainById(a.activity.skill).name),unassessed=checked.filter(a=>a.score===null).map(a=>domainById(a.activity.skill).name);
  return {summary:`${checked.length} of ${state.checkCount} checks completed. ${state.answers.length-checked.length} practice responses saved.`,strengths:[...new Set(strengths)],gaps:[...new Set(gaps)],unassessed:[...new Set(unassessed)],feedback:state.answers.at(-1)?.feedback||'',activity:state.activity};
}
export function validateOpenAssessment(a){
  if(!a||![0,1,2,null].includes(a.score)||typeof a.uncertain!=='boolean'||!small(a.feedback,1600)||!a.feedback.trim())fail(400,'The device model returned incomplete feedback. Retry this response.');
  if(a.practice&&(!skills.includes(a.practice.skill)||!small(a.practice.passage,800)||!small(a.practice.prompt,800)||!a.practice.prompt.trim()||!small(a.practice.answerGuide,800)||!a.practice.answerGuide.trim()||!small(a.practice.hint,800)||(['fluency','decoding','comprehension','listening'].includes(a.practice.skill)&&!a.practice.passage.trim())))fail(400,'The generated practice could not be verified.');
  return {score:a.uncertain?null:a.score,uncertain:a.uncertain,feedback:a.feedback,...(a.practice?{practice:{skill:a.practice.skill,passage:a.practice.passage,prompt:a.practice.prompt,answerGuide:a.practice.answerGuide,hint:a.practice.hint}}:{})};
}
export async function openLearning(db,user,w,lid,method,b){
  if(!await first(db,access,user.id,w,lid))fail(403,'You do not have access to this learner.');
  if(method==='GET'){
    const saved=await stmt(db,"SELECT payload FROM ai_learning_sessions WHERE workspace_id=? AND learner_id=? AND user_id=? AND json_extract(payload,'$.provider')='device' ORDER BY updated_at DESC LIMIT 50",w,lid,user.id).all();
    if(!await first(db,access,user.id,w,lid))fail(403,'Access changed.');
    return {configured:true,provider:'device',models:OPEN_MODELS,sessions:saved.results.map(s=>JSON.parse(s.payload))};
  }
  if(method!=='POST'||!b||!['start','answer','delete'].includes(b.action)||typeof b.requestId!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(b.requestId)||b.consent!==true||!['en-IN','hi-IN'].includes(b.lang)||![1,2,3].includes(b.level))fail(400,'Choose a valid learning context and confirm permission.');
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(b))))].map(v=>v.toString(16).padStart(2,'0')).join('');
  let state,priorVersion=0;
  if(b.action==='start'){
    // The operation ID is also the new session ID, making start retries safe.
    const existing=await first(db,'SELECT payload FROM ai_learning_sessions WHERE id=? AND workspace_id=? AND learner_id=? AND user_id=?',b.requestId,w,lid,user.id);
    if(existing){const s=JSON.parse(existing.payload);if(s.startDigest!==digest)fail(409,'This session request was already used.');return {state:s,duplicate:true}}
    const count=await first(db,"SELECT count(*) AS n FROM ai_learning_sessions WHERE workspace_id=? AND learner_id=? AND user_id=? AND lang=? AND level=? AND json_extract(payload,'$.provider')='device'",w,lid,user.id,b.lang,b.level);
    state={id:b.requestId,provider:'device',lang:b.lang,level:b.level,form:count.n%2?'B':'A',version:1,checkCount:skills.length,totalSteps:skills.length+2,answers:[],completed:false,models:OPEN_MODELS,createdAt:Date.now(),startDigest:digest,consentAt:Date.now()};state.activity=activity(state,'fluency');
  }else{
    if(typeof b.sessionId!=='string'||b.sessionId.length>80||!Number.isInteger(b.version))fail(400,'Choose a saved session.');
    const row=await first(db,'SELECT payload FROM ai_learning_sessions WHERE id=? AND workspace_id=? AND learner_id=? AND user_id=?',b.sessionId,w,lid,user.id);if(!row)fail(404,'Session not found.');state=JSON.parse(row.payload);
    if(state.provider!=='device'||state.lang!==b.lang||state.level!==b.level)fail(409,'This is a different learning context.');
    if(state.lastRequest===b.requestId){if(state.lastDigest!==digest)fail(409,'This request was already used.');return {state,duplicate:true}}
    if(state.version!==b.version)fail(409,'Another tab changed this session. Reopen it to see saved progress.');priorVersion=state.version;
    if(b.action==='delete'){
      const r=await stmt(db,`DELETE FROM ai_learning_sessions WHERE id=? AND user_id=? AND json_extract(payload,'$.version')=? AND EXISTS (${access})`,state.id,user.id,priorVersion,user.id,w,lid).run();if(!r.meta.changes)fail(409,'The session changed. Reopen it before deleting.');return {deleted:state.id};
    }
    if(state.completed)fail(409,'This session is complete.');
    if(!small(b.answer,6000)||!b.answer.trim()||typeof b.supported!=='boolean'||!['typed','speech','image'].includes(b.source))fail(400,'A learner response is required.');
    if(state.activity.skill==='writing'&&b.source==='speech')fail(400,'Writing requires a written response.');
    if(['fluency','decoding','speaking'].includes(state.activity.skill)&&b.source!=='speech')fail(400,'Record the learner’s oral response.');
    if(b.source==='image'&&(state.activity.skill!=='writing'||b.imageConfirmed!==true))fail(400,'Review extracted writing before assessment.');
    const result=validateOpenAssessment(b.assessment);if(b.supported&&result.score===2)result.score=1;
    let reading=null;
    if(['fluency','decoding'].includes(state.activity.skill)){
      if(!Number.isFinite(b.seconds)||b.seconds<=0||b.seconds>120)fail(400,'Use a recording no longer than two minutes.');
      const aligned=align(state.activity.passage,b.answer);reading={...aligned,seconds:b.seconds,metrics:metrics(aligned.states,b.seconds),provisional:true};result.score=null;
    }
    const stage=state.answers.length;
    state.answers.push({stage,activity:state.activity,response:b.answer.trim(),source:b.source,supported:b.supported,score:result.score,uncertain:result.uncertain,feedback:result.feedback,reading,at:Date.now(),provenance:'device-model-output-unverified'});
    const next=state.answers.length;state.completed=next>=state.totalSteps;
    if(state.completed)state.activity=null;
    else if(next<state.checkCount)state.activity=activity(state,skills[next]);
    else{
      const candidates=state.answers.filter(a=>a.stage<state.checkCount&&a.score!==null).sort((a,b)=>a.score-b.score);
      const focus=candidates[0]?.activity.skill||'comprehension';state.activity=activity(state,focus,true);
      // The server chooses the focus; the model cannot replace it with another skill.
      if(result.practice?.skill===focus)state.activity={...result.practice,generated:true};
    }
    state.version++;state.lastRequest=b.requestId;state.lastDigest=digest;
  }
  state.updatedAt=Date.now();state.report=report(state);
  const result=await stmt(db,`INSERT INTO ai_learning_sessions (id,workspace_id,learner_id,user_id,lang,level,payload,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (${access}) AND (?<>0 OR (SELECT count(*) FROM ai_learning_sessions WHERE workspace_id=?)<500) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at WHERE ai_learning_sessions.user_id=? AND ai_learning_sessions.workspace_id=? AND ai_learning_sessions.learner_id=? AND json_extract(ai_learning_sessions.payload,'$.version')=?`,state.id,w,lid,user.id,b.lang,b.level,JSON.stringify(state),state.updatedAt,user.id,w,lid,priorVersion,w,user.id,w,lid,priorVersion).run();
  if(!result.meta.changes)fail(409,'The session changed or this workspace is full. Your response is still in this tab.');
  return {state};
}
