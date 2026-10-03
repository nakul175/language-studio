import { DOMAINS, makeBank } from './curriculum.mjs';
export const STORE_KEY = 'language-studio-v2';
const languages = ['en-IN', 'hi-IN'];
const skills = DOMAINS.map(d => d.id);
const shortText = (v, max=2000) => typeof v === 'string' && v.length <= max;
const identifier = v => shortText(v, 120) && v.trim().length > 0;
export const codeKey = value => value.trim().normalize('NFC').toLocaleLowerCase();
export const compareSessions = (a,b) => Date.parse(a.at)-Date.parse(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export const backupBytes = text => new Blob([text]).size;
const itemBanks = new Map();
function sessionItems(s) {
  const key=s.lang+'/'+s.level+'/'+(s.form||'all');
  if(!itemBanks.has(key))itemBanks.set(key,new Map((s.form?[s.form]:['A','B']).flatMap(form=>makeBank(s.lang,s.level,form)).map(q=>[q.id,q])));
  return itemBanks.get(key);
}
export function validResponse(r,q) {
  if(!q||r.item!==q.id||r.domain!==q.domain)return false;
  if(r.score===null)return (r.answer==null)&&!r.supported&&!r.response;
  if(r.score===2&&r.supported===true||r.score===1&&r.supported===false)return false;
  if(q.kind==='observed')return r.answer==null||r.answer===r.score;
  const answer=r.answer==null?q.options.indexOf(r.response):r.answer;
  if(!Number.isInteger(answer)||answer<0||answer>=q.options.length||r.response!==q.options[answer])return false;
  return r.score===questionScore(q,answer,r.supported===true||r.score===1);
}
export function emptyData() { return { version:2, learners:[], sessions:[] }; }
export const isReadingSession = s => s.mode === 'fluency' || (s.mode === 'practice' && s.domain === 'fluency' && !!s.metrics);
export function validMetrics(m, seconds) {
  if (!m || !Number.isFinite(seconds) || seconds < 1 || seconds > 3600) return false;
  if (!['correct','error','skipped','attempted'].every(k => Number.isInteger(m[k]) && m[k] >= 0 && m[k] <= 500)) return false;
  return m.attempted > 0 && m.attempted === m.correct + m.error + m.skipped &&
    m.cwpm === Math.round(m.correct * 60 / seconds) &&
    m.accuracy === Math.round(m.correct / m.attempted * 100);
}
export function validSession(s) {
  if (!s || !identifier(s.id) || !identifier(s.learner) ||
      !languages.includes(s.lang) || ![1,2,3].includes(s.level) ||
      !['diagnostic','recheck','practice','fluency'].includes(s.mode) ||
      !shortText(s.at,40) || !Number.isFinite(Date.parse(s.at)) ||
      (s.domain != null && !skills.includes(s.domain)) ||
      (s.form != null && !['A','B','reader'].includes(s.form)) ||
      !Array.isArray(s.responses) || s.responses.length > 100) return false;
  if (!s.responses.every(r => r && identifier(r.item) && skills.includes(r.domain) &&
      (r.score === null || [0,1,2].includes(r.score)) &&
      (r.response == null || shortText(r.response)) &&
      (r.note == null || shortText(r.note,500)) &&
      (r.evidence == null || shortText(r.evidence,2000)) &&
      (r.tag == null || shortText(r.tag,150)) &&
      (r.supported == null || typeof r.supported === 'boolean'))) return false;
  if (new Set(s.responses.map(r=>r.item)).size !== s.responses.length) return false;
  if (isReadingSession(s)) {
    if (s.responses.length || !validMetrics(s.metrics,s.seconds) || !shortText(s.passage,300)) return false;
    if (s.transcript != null && !shortText(s.transcript,6000)) return false;
    if (s.words != null && (!Array.isArray(s.words) || s.words.length > 500 ||
        !s.words.every(w=>w && shortText(w.word,150) && !/\s/u.test(w.word) && /[\p{L}\p{N}]/u.test(w.word) && ['correct','error','skipped','unread'].includes(w.state)))) return false;
    if(s.words){
      const reached=s.words.slice(0,s.words.findLastIndex(w=>w.state!=='unread')+1);
      const correct=reached.filter(w=>w.state==='correct').length,error=reached.filter(w=>w.state==='error').length;
      if(s.metrics.attempted!==reached.length||s.metrics.correct!==correct||s.metrics.error!==error||s.metrics.skipped!==reached.length-correct-error)return false;
    }
    if(s.passageText!=null){
      if(!shortText(s.passageText,6000)||!s.words)return false;
      const words=s.passageText.trim().split(/\s+/u).filter(w=>/[\p{L}\p{N}]/u.test(w));
      if(words.length!==s.words.length||words.some((w,i)=>w!==s.words[i].word))return false;
    }
  }else{
    if(s.mode==='fluency'||s.domain==='fluency'||s.form==='reader'||s.metrics!=null)return false;
    const bank=sessionItems(s);
    if(!s.responses.every(r=>(!s.domain||r.domain===s.domain)&&validResponse(r,bank.get(r.item))))return false;
  }
  return true;
}
export function validateBackup(d) {
  if (!d || d.version!==2 || !Array.isArray(d.learners) || !Array.isArray(d.sessions) ||
      d.learners.length>500 || d.sessions.length>10000) return false;
  const ids=d.learners.map(l=>l?.id), sessionIds=d.sessions.map(s=>s?.id);
  return new Set(ids).size===ids.length && new Set(sessionIds).size===sessionIds.length &&
    d.learners.every(l=>l && identifier(l.id) && shortText(l.code,50) && l.code.trim().length>0) &&
    new Set(d.learners.map(l=>codeKey(l.code))).size===d.learners.length &&
    d.sessions.every(s=>validSession(s) && ids.includes(s.learner));
}
export function loadData(storage) {
  const raw=storage.getItem(STORE_KEY);
  if (!raw) return emptyData();
  const parsed=JSON.parse(raw);
  if (!validateBackup(parsed)) throw Error('Saved data is invalid. Export it before resetting.');
  return { version:2, learners:parsed.learners, sessions:parsed.sessions };
}
export function mergeBackup(current,incoming) {
  if (!validateBackup(current) || !validateBackup(incoming)) throw Error('Invalid backup');
  const learnerIds=new Map(current.learners.map(l=>[l.id,l]));
  for (const l of incoming.learners) {
    if (learnerIds.has(l.id) && learnerIds.get(l.id).code!==l.code) throw Error('Learner ID conflict: '+l.code);
    if(current.learners.some(existing=>existing.id!==l.id&&codeKey(existing.code)===codeKey(l.code)))throw Error('Learner code conflict: '+l.code+'. Rename one learner before merging.');
  }
  const sessionIds=new Set(current.sessions.map(s=>s.id));
  const merged={version:2,learners:[...current.learners,...incoming.learners.filter(l=>!learnerIds.has(l.id))],
    sessions:[...current.sessions,...incoming.sessions.filter(s=>!sessionIds.has(s.id))]};
  if (!validateBackup(merged)) throw Error('Combined backup exceeds the supported record limits.');
  return merged;
}
// Called while holding the browser-wide write lock. Apply only this tab's
// changes to the current durable snapshot, preserving other tabs' additions.
export function reconcileChanges(base,next,current) {
  if(!validateBackup(base)||!validateBackup(next)||!validateBackup(current))throw Error('Invalid saved data. Export a recovery copy before continuing.');
  const before=new Map(base.learners.map(l=>[l.id,l])),after=new Map(next.learners.map(l=>[l.id,l]));
  const removed=new Set(base.learners.filter(l=>!after.has(l.id)).map(l=>l.id));
  const learners=new Map(current.learners.filter(l=>!removed.has(l.id)).map(l=>[l.id,l]));
  for(const l of next.learners){
    const old=before.get(l.id),fresh=learners.get(l.id);
    if(!old){if(fresh&&fresh.code!==l.code)throw Error('Learner ID conflict. Reload the learner list.');if(!fresh)learners.set(l.id,l)}
    else if(old.code!==l.code){
      if(!fresh)throw Error('This learner was deleted in another tab. Nothing was saved.');
      if(fresh.code!==old.code&&fresh.code!==l.code)throw Error('This learner was renamed in another tab. Reload before renaming.');
      learners.set(l.id,l);
    }
  }
  const sessions=new Map(current.sessions.filter(s=>learners.has(s.learner)).map(s=>[s.id,s]));
  const prior=new Set(base.sessions.map(s=>s.id));
  for(const s of next.sessions){
    if(!prior.has(s.id)){
      if(!learners.has(s.learner))throw Error('This learner was deleted in another tab. Nothing was saved.');
      // Completion IDs are immutable. Retries and duplicate draft finishes keep
      // the first durable result instead of silently changing its evidence.
      if(!sessions.has(s.id))sessions.set(s.id,s);
    }
  }
  const merged={version:2,learners:[...learners.values()],sessions:[...sessions.values()]};
  if(!validateBackup(merged))throw Error('Learner codes conflict or the combined data exceeds the supported limits.');
  return merged;
}
export function questionScore(item,answer,supported=false) {
  if(answer===null||answer===undefined) return null;
  if(item.kind==='observed') return [0,1,2].includes(answer)?answer:null;
  return answer===item.answer?(supported?1:2):0;
}
export function domainSummary(data,learner,lang,level) {
  const filtered=data.sessions.filter(s=>s.learner===learner&&s.lang===lang&&s.level===level&&s.mode!=='practice')
    .sort(compareSessions);
  return DOMAINS.map(d=>{
    if(d.id==='fluency') {
      const runs=filtered.filter(s=>s.mode==='fluency'&&s.metrics), latest=runs.at(-1);
      return {...d,latest,previous:runs.length>1?runs.at(-2):null,count:runs.length,ratio:latest?latest.metrics.accuracy/100:null,status:latest?'Teacher reviewed':'Not yet checked'};
    }
    const runs=filtered.map(s=>({session:s,rows:s.responses.filter(r=>r.domain===d.id&&r.score!==null)})).filter(s=>s.rows.length), last=runs.at(-1);
    if(!last) return {...d,count:0,ratio:null,independent:0,guided:0,notYet:0,status:'Not yet checked',latest:null};
    const {session,rows}=last, independent=rows.filter(r=>r.score===2).length,guided=rows.filter(r=>r.score===1).length,notYet=rows.filter(r=>r.score===0).length;
    return {...d,count:rows.length,independent,guided,notYet,ratio:independent/rows.length,status:independent===rows.length?'Independent on these items':independent===0?'Guided practice needed':'Building independence',latest:session,previous:runs.length>1?runs.at(-2).session:null,rows};
  });
}
export function priorities(summary) {
  return summary.filter(d=>d.ratio!==null&&d.id!=='fluency'&&d.ratio<1)
    .sort((a,b)=>a.ratio-b.ratio||skills.indexOf(a.id)-skills.indexOf(b.id)).slice(0,3);
}
export function interpretation(summary) {
  const get=id=>summary.find(d=>d.id===id), read=get('comprehension'),listen=get('listening'),decode=get('decoding');
  if(listen.ratio!==null&&read.ratio!==null&&listen.ratio>read.ratio&&decode.ratio!==null&&decode.ratio<1)
    return {title:'Check the word-reading load',text:'The learner answered more listening items independently than reading-comprehension items, and needed some help reading words. Practise word reading while discussing meaning aloud. This small sample does not establish a cause.'};
  if(read.ratio!==null&&read.ratio<1&&decode.ratio===1)
    return {title:'Look more closely at meaning',text:'The learner read the sampled words independently but needed support with some reading questions. Work on vocabulary, sentence meaning and finding evidence in the text. Use more items before drawing a conclusion.'};
  const p=priorities(summary);
  return p.length?{title:'Begin with '+p[0].name.toLowerCase(),text:'The latest check showed fewer independent responses in this area. Start with a short guided activity, then use the alternate check to gather new evidence.'}:
    {title:summary.some(d=>d.ratio!==null)?'Gather evidence in a new context':'Begin with a baseline',text:summary.some(d=>d.ratio!==null)?'Review any unchecked skills and try a different passage. A few correct responses do not establish mastery or a grade level.':'Use the short diagnostic to see what the learner can do independently. Skipped items stay unassessed.'};
}
export function csvCell(v) {
  let s=String(v??'');
  if (/^[\s]*[=+@\-]/.test(s)||/^[\t\r]/.test(s)) s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
export function sessionCSV(data,learner) {
  const rows=[['Learner code','Date','Language','Level','Type','Skill','Item','Score (0-2)','Support','Response','Notes','Correct words/min','Accuracy']];
  for(const s of data.sessions.filter(x=>!learner||x.learner===learner)) {
    const code=data.learners.find(l=>l.id===s.learner)?.code||s.learner, base=[code,s.at,s.lang,s.level,s.mode];
    if(isReadingSession(s)) rows.push([...base,'fluency',s.passage||'','','',s.transcript||'','',s.metrics.cwpm,s.metrics.accuracy]);
    else for(const r of s.responses) rows.push([...base,r.domain,r.item,r.score===null?'Unassessed':r.score,r.supported?'Yes':'No',r.response||'',r.note||'','','']);
  }
  return '\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
}
