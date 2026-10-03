import {DOMAINS,LEVELS,LANGUAGES,makeBank,domainById} from './curriculum.mjs';
import {STORE_KEY,emptyData,loadData,questionScore,domainSummary,priorities,interpretation,sessionCSV,validateBackup,mergeBackup,validSession,isReadingSession,validResponse,codeKey,compareSessions,backupBytes,reconcileChanges} from './engine.mjs';
import {withStorageLock} from './storage.mjs';
const CLOUD_MODE=window.CLOUD_MODE===true;
const cloudState={status:'loading',user:null,role:null,workspaces:[],revision:0,workspaceId:null,writeQueue:Promise.resolve(),draftQueue:Promise.resolve(),pendingDraft:null,recoveries:new Map(),completedIds:new Set(),signIn:'/signin-with-chatgpt?return_to=%2F',signOut:'/signout-with-chatgpt?return_to=%2F'};
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let storage;try{storage=localStorage}catch{storage={getItem:()=>null,setItem:()=>{throw Error('Storage unavailable')}}}
let recoveryError=false,hasUnsaved=false,data;try{data=CLOUD_MODE?emptyData():loadData(storage)}catch{data=emptyData();recoveryError=true}let selected=data.learners[0]?.id||'',lang='en-IN',level=1,view='overview',demo=false,original=null,run=null,readerSession=null,utterance=null,toastTimer;
let durableData=data,recordsUnsaved=false,draftUnsaved=false,pendingWrites=0;
let activityGeneration=0;
function updateUnsaved(){
  hasUnsaved=recordsUnsaved||draftUnsaved||pendingWrites>0;
  if(CLOUD_MODE&&$('cloudSaveStatus'))$('cloudSaveStatus').textContent=hasUnsaved?cloudHasTransientWork()?'Changes waiting to save — keep this tab open':[...cloudState.recoveries.values()].every(r=>r.stored)?'Completed results saved for recovery — open Saved work':'Completed results saved on this device — waiting to save online':navigator.onLine===false?'Offline · reconnect to save online':'Saved to '+(cloudState.workspaceName||'your workspace');
}
const uid=()=>globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2),learner=()=>data.learners.find(l=>l.id===selected),summary=()=>CLOUD_MODE&&!demo?cloudSummary():domainSummary(data,selected,lang,level),filtered=()=>data.sessions.filter(s=>s.learner===selected&&s.lang===lang&&s.level===level);
const CONTEXT_KEY='language-studio-context-v1';
try{const c=JSON.parse(storage.getItem(CONTEXT_KEY)||'null');if(c&&data.learners.some(l=>l.id===c.selected)&&LANGUAGES[c.lang]&&[1,2,3].includes(c.level)){selected=c.selected;lang=c.lang;level=c.level}}catch{}
function rememberContext(){if(demo||!learner())return;try{storage.setItem(CONTEXT_KEY,JSON.stringify({selected,lang,level}))}catch{}}
function toast(t){const notice=$('activityNotice');if(notice)notice.textContent=t;clearTimeout(toastTimer);$('toast').textContent=t;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,5500)}
function persist(next,done=()=>{}){
  if(demo){data=next;done(true,{});return true}
  if(CLOUD_MODE)return cloudPersist(next,done);
  const reject=message=>{toast(message);done(false,{rejected:true,error:message});return false};
  if(recoveryError)return reject('Saved data needs recovery. Export the original data from Saved work; it has not been overwritten.');
  if(!validateBackup(next))return reject('The record failed validation or exceeds the supported record limits.');
  const base=durableData;pendingWrites++;updateUnsaved();let completed=false;
  const finish=(saved,detail)=>{if(completed)return saved;completed=true;pendingWrites--;updateUnsaved();done(saved,detail);return saved};
  const unavailable=error=>{if(completed)return false;toast(error.message||'Could not save to this browser. Download a backup before closing.');return finish(false,{storageFailure:true,error:error.message})};
  return withStorageLock(()=>{
    if(completed)return false;
    let fresh;try{fresh=loadData(storage)}catch(error){return unavailable(error)}
    let merged;try{merged=reconcileChanges(base,next,fresh)}catch(error){
      if(!recordsUnsaved){data=fresh;durableData=fresh;if(!learner())selected=data.learners[0]?.id||''}
      toast(error.message);return finish(false,{rejected:true,error:error.message});
    }
    try{storage.setItem(STORE_KEY,JSON.stringify(merged))}catch(error){return unavailable(error)}
    data=merged;durableData=merged;recordsUnsaved=false;
    return finish(true,{previous:fresh});
  },unavailable);
}
function commitSession(s,done=()=>{}){
  if(!validSession(s)||!data.learners.some(l=>l.id===s.learner)){
    const error='This result or its learner is no longer valid. Nothing was saved.';toast(error);done(false,{rejected:true,error});return false;
  }
  if(CLOUD_MODE&&!demo)return cloudCommitSession(s,done);
  const next={...data,sessions:[...data.sessions.filter(x=>x.id!==s.id),s]};
  return persist(next,(saved,detail)=>{
    if(!saved&&detail.storageFailure){data=next;recordsUnsaved=true;updateUnsaved()}
    const existing=data.sessions.find(x=>x.id===s.id);
    render();done(saved,{...detail,record:existing,duplicate:!!detail.previous?.sessions.some(x=>x.id===s.id)});
  });
}
function speak(text,onEnd){if(!('speechSynthesis' in window)){toast('Speech playback is unavailable. An adult can read the script.');return}speakStop();const voices=speechSynthesis.getVoices(),v=voices.find(v=>v.lang.toLowerCase()===lang.toLowerCase())||voices.find(v=>v.lang.split('-')[0]===lang.split('-')[0]);if(!v){toast('No voice for this language is installed. An adult can read the script.');return}utterance=new SpeechSynthesisUtterance(text);utterance.voice=v;utterance.lang=lang;utterance.rate=.87;utterance.onend=()=>{if(onEnd)onEnd()};utterance.onerror=()=>toast('Playback did not finish. Use the adult-read script.');speechSynthesis.speak(utterance)}
function speakStop(){if('speechSynthesis' in window)speechSynthesis.cancel();utterance=null}
function updateContext() {
  const select=$('learnerSelect');
  select.innerHTML=data.learners.length?data.learners.map(l=>'<option value="'+esc(l.id)+'">'+esc(l.code)+'</option>').join(''):'<option value="">Add a learner</option>';
  select.value=selected;
  $('langSelect').value=lang;$('levelSelect').value=level;
  $('contextSummary').textContent=LANGUAGES[lang]+' · '+levelNames[level-1];
  $('learnerBar').hidden=!learner();
  $('demoBanner').hidden=!demo;$('demoBtn').textContent=demo?'Sample mode active':'Try a sample learner';
}
function nav(){const v=location.hash.slice(1)||'overview';view=['overview','diagnostic','practice','reading','report'].includes(v)?v:'overview';render()}
const levelNames = ['Words & short sentences', 'Connected sentences', 'Longer stories'];
const modeNames = {diagnostic:'Learning check',recheck:'Check again',practice:'Practice',fluency:'Reading check'};
const skillNames = {sounds:'Sounds',decoding:'Reading words',vocabulary:'Word meanings',listening:'Listening',fluency:'Reading aloud',comprehension:'Understanding stories',speaking:'Speaking',writing:'Writing'};
const skillName = id => skillNames[id] || domainById(id)?.name || 'Language skills';
function head(eyebrow,title,subtitle,actions='') {
  return '<div class="page-head"><div><h1>'+title+'</h1>'+(subtitle?'<p>'+subtitle+'</p>':'')+'</div>'+actions+'</div>';
}
function mark(d) { return '<span class="skill-mark" aria-hidden="true" style="--domain:'+d.color+'">'+d.mark+'</span>'; }
function btn(label,action,domain='',style='secondary') {
  return '<button class="button '+style+'" data-action="'+esc(action)+'" data-domain="'+esc(domain)+'">'+esc(label)+'</button>';
}
function noLearner() {
  if(CLOUD_MODE&&!cloudCanManageLearners())return head("YOUR LEARNING SPACE","No learners assigned yet","Ask your workspace administrator to assign a learner to your account. Their activities and progress will appear here.");
  return '<section class="welcome card"><span class="eyebrow">FOR TEACHERS & PARENTS</span><h1>Start learning together</h1><p>Add a learner’s nickname and choose English or Hindi. Then check skills, practise together or listen to a reading.</p>'+btn('Add your first learner','add','','primary')+'<div class="simple-path"><span><b>1</b> Add learner</span><span><b>2</b> Choose activity</span><span><b>3</b> Review together</span></div><p class="small">You guide the activity. No child account or installation needed.</p></section>';
}
function metricText(d) {
  if(d.id==='fluency')return d.latest?d.latest.metrics.cwpm+' <small>correct words / min</small>':'Not checked';
  return d.count?d.independent+' <small>of '+d.count+' on their own</small>':'Not checked';
}
function skillStatus(d) {
  return d.ratio===null?'Not checked':d.id==='fluency'?'Reviewed':d.ratio===1?'On their own':'Keep practising';
}
function suggestedCard(d,compact=false) {
  return '<section class="recommendation'+(compact?' home-recommendation':'')+'"><div><span class="eyebrow">SUGGESTED NEXT STEP</span><h2>Practise '+esc(skillName(d.id).toLowerCase())+'</h2><p>'+esc(d.routine[0])+'</p></div>'+btn('Start practice','practice',d.id,'primary')+'</section>';
}
function overview(){const content=manualOverview();return CLOUD_MODE&&!demo?'<details class="ai-manual"><summary>Adult-led activities and existing records</summary><div>'+content+'</div></details>':content}
function manualOverview() {
  const focus=priorities(summary()),runs=filtered();
  return head('', 'Choose an activity', '')+
    (focus.length?suggestedCard(focus[0],true):'')+
    '<div class="activity-choices">'+
      '<section class="activity-choice"><span class="choice-icon" aria-hidden="true">Aa</span><h2>Check skills</h2><p>Find what they can do on their own and where they need help.</p><span class="activity-detail">13 questions · pause anytime</span>'+btn('Start check','baseline','','primary')+'<a href="#diagnostic">Or check just one skill</a></section>'+
      '<section class="activity-choice"><span class="choice-icon" aria-hidden="true">ab</span><h2>Practise</h2><p>Build a skill with a simple teaching activity and guided questions.</p><span class="activity-detail">Choose from 8 language skills</span><a class="button secondary" href="#practice">Choose practice</a></section>'+
      '<section class="activity-choice"><span class="choice-icon" aria-hidden="true">↗</span><h2>Read aloud</h2><p>Listen to a passage, review the words and save the reading.</p><span class="activity-detail">Record or score without a microphone</span>'+btn('Start reading','reader')+'</section></div>'+
    '<section class="section-gap"><div class="section-heading"><h2>'+(runs.length?'Recent activity':'What happens after an activity?')+'</h2>'+(runs.length?'<a class="link-button" href="#report">See all progress</a>':'')+'</div>'+(runs.length?'<div class="card recent-card">'+recent()+'</div>':'<div class="after-activity"><div><strong>Review the result</strong><p>See what they did independently and with help.</p></div><div><strong>Find the next activity</strong><p>Use the suggested practice to work on a skill.</p></div><div><strong>Follow their progress</strong><p>Completed activities stay '+(CLOUD_MODE?'in your learning space':'in this browser')+'.</p></div></div>')+'</section>';
}
function sessionRows(runs) {
  return runs.map(s=>'<button class="history-row" data-action="session" data-domain="'+esc(s.id)+'"><span class="history-icon" aria-hidden="true">'+(isReadingSession(s)?'Aa':s.mode==='practice'?'↗':'✓')+'</span><span class="history-copy"><strong>'+esc(s.domain?skillName(s.domain):'Language skills')+'</strong><span>'+modeNames[s.mode]+(s.repeated?' · repeated questions':'')+'</span></span><time>'+new Date(s.at).toLocaleDateString(undefined,{day:'numeric',month:'short'})+'</time><span aria-hidden="true">›</span></button>').join('');
}
function recent() {
  const runs=[...filtered()].sort((a,b)=>compareSessions(b,a)).slice(0,3);
  return runs.length?sessionRows(runs):'<div class="empty"><p>Your completed checks and practice will appear here.</p></div>';
}
function diagnostic() {
  return '<a class="back-link" href="#overview">All activities</a>'+head('','Check a skill','Choose one skill, or run the full learning check.')+
    '<section class="recommendation"><div><h2>Check all language skills</h2><p>13 questions, one at a time. You can pause and continue later. Reading aloud is a separate activity.</p></div>'+btn('Start learning check','baseline','','primary')+'</section>'+
    '<div class="card skill-list">'+DOMAINS.map(d=>'<div class="skill-row">'+mark(d)+'<div><h3>'+skillName(d.id)+'</h3><p>'+esc(d.description)+'</p></div>'+btn(d.id==='fluency'?'Start reading':'Check '+skillName(d.id).toLowerCase(),d.id==='fluency'?'reader':'check',d.id)+'</div>').join('')+'</div>';
}
function practiceView() {
  const focus=priorities(summary());
  return '<a class="back-link" href="#overview">All activities</a>'+head('','What would you like to practise?','Each activity shows you what to teach, then gives the learner a turn.')+
    (focus.length?suggestedCard(focus[0]):'')+
    '<div class="practice-grid">'+DOMAINS.map(d=>'<button class="practice-card" data-action="'+(d.id==='fluency'?'reader-practice':'practice')+'" data-domain="'+d.id+'">'+mark(d)+'<span><strong>'+skillName(d.id)+'</strong><span>'+esc(d.description)+'</span><small>'+(d.id==='fluency'?'Read a passage together':'Teaching steps + '+makeBank(lang,level,'A').filter(i=>i.domain===d.id).length+' questions')+'</small></span><span class="card-chevron" aria-hidden="true">›</span></button>').join('')+'</div>';
}
function readingView() {
  const rs=filtered().filter(s=>s.mode==='fluency').sort(compareSessions),last=rs.at(-1);
  return '<a class="back-link" href="#overview">All activities</a>'+head('','Read aloud','Sit with the learner and listen to a short passage.')+
    '<section class="next-card"><div><span class="eyebrow">READ · REVIEW · SAVE</span><h2>Ready when they are.</h2><p>Record a reading, or score it without a microphone. You’ll review the words before saving.</p></div>'+btn('Start reading','reader','','primary')+'</section>'+
    (last?'<section class="card section-gap"><div class="section-heading"><h2>Last reading</h2>'+btn('See reading','session',last.id)+'</div><div class="result-counts"><div><strong>'+last.metrics.cwpm+'</strong><span>correct words / min</span></div><div><strong>'+last.metrics.accuracy+'%</strong><span>accuracy</span></div></div></section>':'')+
    '<details class="card section-gap"><summary>Practice and reading guidance</summary><p>For a practice reading, model difficult words and read the passage again. Practice is saved separately from checks.</p>'+btn('Start a practice reading','reader-practice')+'<p>A fluent reading does not establish understanding. Follow it with a story question.</p>'+btn('Check understanding','check','comprehension')+'<ol class="routine">'+domainById('fluency').routine.map(t=>'<li>'+esc(t)+'</li>').join('')+'</ol></details>';
}
function report() {
  const s=summary(),runs=filtered(),focus=priorities(s),checked=s.filter(d=>d.ratio!==null).length,total=CLOUD_MODE?cloudState.progress.total:runs.length,practiceCount=CLOUD_MODE?cloudState.progress.practice:runs.filter(r=>r.mode==='practice').length;
  const row=d=>'<button class="progress-row" data-action="skill" data-domain="'+d.id+'">'+mark(d)+'<span class="progress-skill"><strong>'+skillName(d.id)+'</strong><span>'+metricText(d)+'</span></span><span class="status '+(d.ratio===null?'neutral':d.ratio===1?'good':'growing')+'">'+skillStatus(d)+'</span><span aria-hidden="true">›</span></button>';
  return head('','Progress for '+esc(learner().code),'Results for the selected language and level.',
    '<details class="export-menu"><summary>Export report</summary><p class="small">CSV includes this learner’s scores across all languages and levels.</p><div class="button-row">'+btn('Download all learner scores','csv')+btn('Print report','print')+'</div></details>')+
    (focus.length?'<div class="progress-next"><div><span class="eyebrow">NEXT TO PRACTISE</span><strong>'+skillName(focus[0].id)+'</strong></div>'+btn('Practise','practice',focus[0].id,'primary')+'</div>':'')+
    '<div class="progress-summary"><div><strong>'+checked+' / 8</strong><span>Skills checked</span></div><div><strong>'+total+'</strong><span>Activities completed</span></div><div><strong>'+practiceCount+'</strong><span>Practice sessions</span></div></div>'+
    '<section class="card"><div class="section-heading"><h2>Skills at a glance</h2><span class="small">'+esc(LANGUAGES[lang])+' · '+esc(levelNames[level-1])+'</span></div>'+
    (checked?'<div class="progress-list">'+s.filter(d=>d.ratio!==null).map(row).join('')+'</div>':'<div class="empty"><h2>No check results yet</h2><p>Complete a learning check or a reading to see what they can do.</p><div class="button-row">'+btn('Start learning check','baseline','','primary')+btn('Start reading','reader')+'</div></div>')+
    (checked&&checked<8?'<details class="unchecked-skills"><summary>'+ (8-checked)+' skills not checked yet</summary>'+s.filter(d=>d.ratio===null).map(row).join('')+'</details>':'')+
    '<p class="small">These are small snapshots of learning, not grades or a diagnosis. Practice does not change check results.</p></section>'+
    '<details class="card section-gap"><summary>Compare checks and see teaching notes</summary><div class="table-wrap"><table><thead><tr><th>Skill</th><th>Previous check</th><th>Latest check</th><th>With help / not yet</th></tr></thead><tbody>'+s.map(d=>'<tr><td>'+skillName(d.id)+'</td><td>'+priorResult(d)+'</td><td>'+metricText(d)+'</td><td>'+(d.id==='fluency'?'—':d.count?d.guided+' / '+d.notYet:'—')+'</td></tr>').join('')+'</tbody></table></div><p>'+esc(interpretation(s).text)+'</p><p class="small">Different forms and passages have not been equated. Task difficulty, familiarity and help can affect results. No overall ability score is calculated.</p></details>'+
    '<section class="section-gap"><div class="section-heading"><h2 id="historyHeading" tabindex="-1">All activity</h2><span class="small">'+total+' sessions</span></div><div class="card recent-card">'+(CLOUD_MODE?cloudHistory():recentAll(runs))+'</div></section>';
}
function priorResult(d) {
  if(!d.previous)return 'No earlier check';
  if(d.id==='fluency')return d.previous.metrics.cwpm+' correct words / min';
  const rows=d.previous.responses.filter(r=>r.domain===d.id&&r.score!==null);
  return rows.filter(r=>r.score===2).length+' of '+rows.length+' on their own';
}
function recentAll(runs) {
  return runs.length?sessionRows([...runs].sort((a,b)=>compareSessions(b,a))):'<div class="empty"><p>No completed activity at this language and level.</p>'+btn('Start a check','baseline','','primary')+'</div>';
}
function render() {
  if(window.learningAiReady)aiHome();
  if(CLOUD_MODE&&cloudGate())return;
  rememberContext();
  updateContext();
  const active=view==='report'?'report':'overview';
  document.querySelectorAll('nav a').forEach(a=>{if(a.dataset.view===active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
  const progressPanel=CLOUD_MODE&&learner()?cloudProgressPanel():null;
  $('workspace').innerHTML=!learner()?noLearner():progressPanel??({overview,diagnostic,practice:practiceView,reading:readingView,report}[view])();
  renderResume();
  if(CLOUD_MODE)cloudRenderRecovery();
}
function startRun(mode,domain){if(CLOUD_MODE&&!cloudProgressReady()){toast('Wait for this learner’s progress to load.');return}$('activityNotice').textContent='';if(!run&&readDraft()){resumeRun();toast('Resuming the unfinished activity. Finish it or discard it before starting another.');return}if(!learner()){openLearner();return}if(domain==='fluency'){openReader(mode==='practice'?'practice':'fluency');return}activityGeneration++;const form=mode==='recheck'?'B':'A';let items=makeBank(lang,level,form).filter(i=>!domain||i.domain===domain);if(mode==='practice'){const d=summary().find(d=>d.id===domain);if(d?.latest?.form==='B')items=makeBank(lang,level,'B').filter(i=>i.domain===domain)}const seen=new Set(CLOUD_MODE?cloudState.progress.seen:filtered().flatMap(s=>s.responses.map(r=>r.item)));draftRevision=null;lastDraftContent='';run={id:uid(),mode,domain,items,index:0,answers:[],chosen:null,supported:false,note:'',evidence:'',feedback:false,heard:new Set(),form:items[0]?.form||form,repeated:items.some(i=>seen.has(i.id)),learner:selected,lang,level};$('activityMode').textContent=mode==='practice'?'GUIDED PRACTICE':mode==='recheck'?'ALTERNATE CHECK':'DIAGNOSTIC';$('activityTitle').textContent=domain?skillName(domain):'Language skills';if(mode==='practice')showLesson();else renderTask();$('activityDialog').showModal();taskFocus()}
function setActivityProgress(value) {
  $('activityProgress').style.width=value+'%';
  $('activityProgress').parentElement.setAttribute('aria-valuenow',Math.round(value));
}
function taskFocus() {
  const title=$('activityContent').querySelector('h3');
  if(title){title.tabIndex=-1;title.focus({preventScroll:true})}
  $('activityDialog').scrollTop=0;
}
function showLesson() {
  const d=domainById(run.domain);
  $('activityMode').textContent='PRACTISE TOGETHER';
  $('closeActivity').textContent='Save & exit';
  setActivityProgress(0);
  $('activityContent').innerHTML='<div class="task-body"><span class="eyebrow">FIRST, SHOW THEM HOW</span><h3 class="prompt">'+skillName(d.id)+'</h3><ol class="routine">'+d.routine.map(t=>'<li>'+esc(t)+'</li>').join('')+'</ol><p class="small">Then try '+run.items.length+' questions together. Practice is saved separately from checks.</p></div><div class="task-footer"><span class="small">Adult-guided</span><button class="button primary" data-task="begin">Try it together</button></div>';
}
function taskHintText(item) {
  if(item.audio&&!run.heard.has(item.audio))return 'Play or read the story, then confirm the learner heard it.';
  if(run.chosen===null)return item.kind==='choice'?'Select their answer above, or skip this question.':'Select what you observed above, or skip this question.';
  if(run.mode==='practice'&&!run.feedback)return 'Your response is selected. See feedback before moving on.';
  return run.index===run.items.length-1?'Your response is selected. Continue to see the result.':'Your response is selected. Continue to the next question.';
}
function renderTask() {
  if(!run)return;
  saveDraft();speakStop();
  const item=run.items[run.index],h=run.lang==='hi-IN',done=run.feedback?' disabled':'';
  setActivityProgress(run.index/run.items.length*100);
  $('activityMode').textContent=run.mode==='practice'?'PRACTISE TOGETHER':run.mode==='recheck'?'CHECK AGAIN':'LEARNING CHECK';
  $('activityTitle').textContent=skillName(item.domain);
  $('closeActivity').textContent='Save & exit';
  let audio='';
  if(item.audio)audio='<div class="listen-box"><div class="button-row"><button class="button secondary" data-task="listen">Play the story</button><button class="button subtle" data-task="stopVoice">Stop audio</button></div><details><summary>Or read the story aloud yourself</summary><p lang="'+(h?'hi':'en')+'">'+esc(item.audio)+'</p></details><label class="support-check"><input id="heardCheck" type="checkbox" '+(run.heard.has(item.audio)?'checked':'')+done+'><span>The learner has heard the whole story.</span></label></div>';
  let prompt=item.oralOnly?'<div class="oral-cue"><span class="eyebrow">SAY THIS ALOUD · KEEP THE SCREEN FACING YOU</span><h3 class="prompt" lang="'+(h?'hi':'en')+'">'+esc(item.prompt)+'</h3></div>':'<h3 class="prompt" lang="'+(h?'hi':'en')+'">'+esc(item.prompt)+'</h3>';
  let answer;
  if(item.kind==='choice')answer='<div class="options" role="group" aria-label="Answer choices" lang="'+(h?'hi':'en')+'">'+item.options.map((o,i)=>'<button class="option" data-answer="'+i+'" aria-pressed="'+(run.chosen===i)+'"'+done+'><span class="letter">'+String.fromCharCode(65+i)+'</span>'+esc(o)+'</button>').join('')+'</div><label class="support-check"><input id="supported" type="checkbox" '+(run.supported?'checked':'')+done+'><span>I helped with the answer.<br><small>Reading the question or choices aloud does not count as help.</small></span></label>';
  else answer='<details class="rubric" open><summary>What counts as a correct response?</summary><p>'+esc(item.rubric)+'</p><p class="small">Accept local accents and equivalent wording. A clue, model or sentence starter counts as help.</p></details><p class="score-label">How did they do?</p><div class="score-options" role="group" aria-label="Adult observation">'+[[2,'On their own','No clue or model'],[1,'With help','After a clue or model'],[0,'Not yet','Tried, but not correct']].map(([n,t,b])=>'<button class="option" data-answer="'+n+'" aria-pressed="'+(run.chosen===n)+'"'+done+'>'+t+'<small>'+b+'</small></button>').join('')+'</div>';
  const writing=item.writing||item.domain==='speaking';
  const evidence=writing?'<label for="evidenceInput">'+(item.writing?'Their written response':'What they said')+' <span class="small">· optional</span></label><textarea id="evidenceInput" rows="3" maxlength="2000" placeholder="'+(item.writing?'Type their response or use paper':'You can type a short record here')+'">'+esc(run.evidence)+'</textarea>':'';
  $('activityContent').innerHTML='<div class="task-body"><div class="task-meta"><span>Question '+(run.index+1)+' of '+run.items.length+'</span><span>'+esc(learner()?.code)+'</span></div>'+
    (item.passage?'<p class="task-direction">Let the learner read this story.</p><div class="passage-text" lang="'+(h?'hi':'en')+'"><h4>'+esc(item.title)+'</h4>'+esc(item.passage)+'</div>':'')+
    audio+(item.kind==='choice'?'<p class="task-direction">Ask the learner, then select their answer.</p>':'')+prompt+(item.stimulus?'<div class="stimulus" lang="'+(h?'hi':'en')+'">'+esc(item.stimulus)+'</div>':'')+
    (item.readAloud&&!item.audio?'<button class="button subtle" data-task="promptVoice">Read question aloud</button>':'')+answer+
    (run.feedback?'<div class="feedback" role="status"><strong>'+(questionScore(item,run.chosen,run.supported)===2?'They did this one on their own.':'Try this together.')+'</strong><p>'+esc(item.explanation)+'</p></div>':'')+
    '<details class="task-notes" '+(run.note||run.evidence?'open':'')+'><summary>Add a note'+(writing?' or response':'')+' <span class="small">· optional</span></summary>'+evidence+'<label for="taskNote">What did you notice?</label><input id="taskNote" maxlength="500" value="'+esc(run.note)+'" placeholder="e.g. Needed a sentence starter"></details></div>'+
    '<p class="task-hint" id="taskHint">'+taskHintText(item)+'</p><div class="task-footer"><button class="button secondary" data-task="back" '+(run.index===0?'disabled':'')+'>Back</button><button class="button subtle" data-task="skip">Skip</button><button class="button primary" data-task="next" id="taskNext" aria-describedby="taskHint" '+(run.chosen===null||item.audio&&!run.heard.has(item.audio)?'disabled':'')+'>'+(run.mode==='practice'&&!run.feedback?'See feedback':run.index===run.items.length-1?'See results':'Next')+'</button></div>';
  $('taskNote').oninput=e=>{run.note=e.target.value;saveDraft()};
  const input=$('evidenceInput');if(input)input.oninput=e=>{run.evidence=e.target.value;saveDraft()};
  const support=$('supported');if(support)support.onchange=()=>{run.supported=support.checked;saveDraft()};
  const heard=$('heardCheck');if(heard)heard.onchange=()=>{heard.checked?run.heard.add(item.audio):run.heard.delete(item.audio);$('taskNext').disabled=run.chosen===null||!heard.checked;$('taskHint').textContent=taskHintText(item);saveDraft()};
  taskFocus();
}
function nextTask(skip=false){if(!run)return;const item=run.items[run.index];if(!skip&&run.chosen===null)return;if(!skip&&item.audio&&!run.heard.has(item.audio)){toast('Play or read the passage first.');return}if(run.mode==='practice'&&!run.feedback&&!skip){run.feedback=true;renderTask();return}run.answers[run.index]=({item:item.id,domain:item.domain,score:skip?null:questionScore(item,run.chosen,run.supported),supported:!skip&&(item.kind==='observed'?run.chosen===1:run.supported),response:skip?'':item.kind==='choice'?item.options[run.chosen]:(run.evidence||['Not demonstrated','With support','Independent'][run.chosen]),note:run.note,tag:item.tag,answer:skip?null:run.chosen,evidence:run.evidence});run.index++;run.chosen=null;run.supported=false;run.note='';run.evidence='';run.feedback=false;if(run.index>=run.items.length)finishRun();else{restoreAnswer();renderTask()}}
function finishRun(){
  if(!run)return;speakStop();
  const finished=run,generation=activityGeneration,session={id:finished.id,learner:finished.learner,lang:finished.lang,level:finished.level,mode:finished.mode,domain:finished.domain||null,form:finished.form,at:new Date().toISOString(),responses:finished.answers,repeated:finished.repeated};
  run=null;
  $('activityNotice').textContent='Saving result…';
  commitSession(session,(saved,detail)=>{
    const ownsDialog=generation===activityGeneration&&!run&&!readerSession&&$('activityDialog').open;
    if(detail.rejected){if(ownsDialog)toast(detail.error);return}
    if(saved||detail.recoveryStored||detail.deviceStored||!CLOUD_MODE)clearDraft(finished.id,true);renderResume();
    if(!ownsDialog)return;
    showSession(detail.record||session);
    toast(demo?'Sample session complete; it is not saved.':saved?detail.duplicate?'This activity was already completed. Its saved result is shown.':'Session saved.':detail.recoveryStored?'Result saved for recovery. Open Saved work to retry or export it.':detail.deviceStored?'Result saved on this device. Reconnect to save online.':'Result is in this tab only. Download a recovery copy from Saved work before closing.');
  });
}
function showSession(s) {
  activityGeneration++;speakStop();run=null;
  $('activityNotice').textContent='';
  $('activityMode').textContent=modeNames[s.mode].toUpperCase();
  $('activityTitle').textContent=(data.learners.find(l=>l.id===s.learner)?.code||'Learner')+' · '+new Date(s.at).toLocaleDateString();
  $('closeActivity').textContent='Close';
  setActivityProgress(100);
  if(isReadingSession(s)) {
    $('activityContent').innerHTML='<div class="task-body"><h3 class="prompt">'+esc(s.passage)+'</h3><div class="result-counts"><div><strong>'+s.metrics.cwpm+'</strong><span>correct words / min</span></div><div><strong>'+s.metrics.accuracy+'%</strong><span>accuracy</span></div><div><strong>'+s.seconds+'</strong><span>seconds</span></div></div><p class="small">'+(s.mode==='practice'?'Reading practice · kept separate from checks.':'Adult-reviewed reading check.')+' Audio is not retained.</p><details><summary>See words and transcript</summary><p>'+s.metrics.correct+' correct · '+s.metrics.error+' incorrect · '+s.metrics.skipped+' skipped.</p>'+(s.transcript?'<h4>Reviewed transcript</h4><p>'+esc(s.transcript)+'</p>':'')+(s.words?.length?'<div class="saved-words">'+s.words.map(w=>'<span class="saved-word '+esc(w.state)+'" title="'+esc(w.state)+'">'+esc(w.word)+'</span>').join('')+'</div>':'')+'</details></div><div class="task-footer"><button class="button secondary" data-task="report">See progress</button><button class="button primary" data-task="close">Done</button></div>';
  } else {
    const all=[...makeBank(s.lang,s.level,'A'),...makeBank(s.lang,s.level,'B')],assessed=s.responses.filter(r=>r.score!==null);
    const focus=priorities(domainSummary(data,s.learner,s.lang,s.level))[0],target=s.domain||focus?.id;
    const follow=s.mode==='practice'?'recheck':'practice';
    const counts=[['On their own',2],['With help',1],['Not yet',0]].map(([label,n])=>'<div><strong>'+assessed.filter(r=>r.score===n).length+'</strong><span>'+label+'</span></div>').join('');
    const suggestion=target&&assessed.length?'<div class="result-next"><span class="eyebrow">NEXT STEP</span><h3>'+(s.mode==='practice'?'Check again without help':'Practise '+skillName(target).toLowerCase())+'</h3><p>'+(s.mode==='practice'?'This check uses form B. Some questions may have been seen before; familiarity can affect the result.':esc(domainById(target).routine[0]))+'</p></div>':'<p>'+(assessed.length?'Keep exploring other skills or try another passage.':'Every question was skipped. No check results were changed.')+'</p>';
    $('activityContent').innerHTML='<div class="task-body"><h3 class="prompt">'+(s.mode==='practice'?'Practice complete.':'Here’s how it went.')+'</h3><div class="result-counts">'+counts+'</div>'+(s.responses.length>assessed.length?'<p class="small">'+(s.responses.length-assessed.length)+' skipped · not scored.</p>':'')+suggestion+(s.mode==='practice'?'<p class="small">Practice is saved separately. It does not change check results.</p>':'')+
      '<details><summary>See answers and teaching notes</summary>'+(s.repeated?'<p class="small">Some questions have been seen before. Familiarity can affect the result.</p>':'')+
      s.responses.map(r=>{const q=all.find(i=>i.id===r.item);return '<div class="evidence-item"><span class="tag '+(r.score===2?'green':r.score===1?'gold':'')+'">'+(r.score===null?'Skipped':r.score===2?'On their own':r.score===1?'With help':'Not yet')+'</span><h3>'+esc(q?.prompt||r.item)+(q?.stimulus?' '+esc(q.stimulus):'')+'</h3><p><strong>Response:</strong> '+esc(r.response||'No response recorded')+'</p>'+(r.note?'<p><strong>Note:</strong> '+esc(r.note)+'</p>':'')+'<p><strong>Teaching note:</strong> '+esc(q?.explanation||'')+'</p></div>'}).join('')+'</details></div><div class="task-footer"><button class="button secondary" data-task="report">See progress</button>'+
      (target&&assessed.length?'<button class="button primary" data-task="followup" data-domain="'+target+'" data-follow="'+follow+'">'+(follow==='recheck'?'Check again':'Start practice')+'</button>':'<button class="button primary" data-task="close">Done</button>')+'</div>';
  }
  if(!$('activityDialog').open)$('activityDialog').showModal();
  taskFocus();
}
function showSkill(id) {
  activityGeneration++;
  const d=summary().find(d=>d.id===id);
  if(id==='fluency'){location.hash='reading';return}
  $('activityNotice').textContent='';$('activityMode').textContent='SKILL DETAILS';$('activityTitle').textContent=skillName(id);$('closeActivity').textContent='Close';
  setActivityProgress(0);run=null;
  $('activityContent').innerHTML='<div class="task-body"><h3 class="prompt">'+skillName(id)+'</h3><p>'+esc(d.description)+'</p><div class="report-note">'+(d.count?d.independent+' of '+d.count+' questions on their own. '+d.guided+' with help. '+d.notYet+' not yet.':'Not checked at this language and level.')+'</div><details><summary>Previous check and teaching guidance</summary><p>Previous: '+priorResult(d)+'.</p><ol class="routine">'+d.routine.map(t=>'<li>'+esc(t)+'</li>').join('')+'</ol><p class="small">A few questions are a snapshot, not a mastery judgement.</p></details>'+(d.latest?'<button class="button subtle" data-task="session" data-session="'+esc(d.latest.id)+'">See latest answers</button>':'')+'</div><div class="task-footer"><button class="button secondary" data-task="followup" data-follow="'+(d.latest?'recheck':'check')+'" data-domain="'+id+'">'+(d.latest?'Check again':'Check skill')+'</button><button class="button primary" data-task="followup" data-follow="practice" data-domain="'+id+'">Practise</button></div>';
  $('activityDialog').showModal();taskFocus();
}
function closeActivity(){activityGeneration++;const active=!!run;saveDraft();if(CLOUD_MODE)cloudFlushDraft();speakStop();run=null;$('activityDialog').close();render();if(active)toast(demo?'Sample activity closed.':hasUnsaved?(CLOUD_MODE?'Saving your paused activity. Keep this tab open until it is saved.':'Activity is paused in this tab only. Browser storage is unavailable.'):'Activity paused. Choose Continue activity to pick up where you left off.')}
function openReader(mode='fluency'){if(!learner()){openLearner();return}activityGeneration++;speakStop();readerSession={session:uid(),learner:selected,code:learner().code,language:lang,level,mode};const ctx={session:readerSession.session,learner:readerSession.code,language:lang,level:String(level),mode,origin:location.origin};const injection='<script>window.READING_CONTEXT='+JSON.stringify(ctx).replaceAll('<','\\u003c')+';<\/script>';$('readerFrame').srcdoc=READER_HTML.replace('</head>',injection+'</head>');$('readerDialog').showModal()}
function closeReader(){const w=$('readerFrame').contentWindow;try{if((w?.document.body.classList.contains('live')||w?.document.body.dataset.unsaved==='true')&&!confirm('Close this unfinished reading? Unsaved audio and word scores will be lost.'))return;w?.dispatchEvent(new Event('pagehide'))}catch{}$('readerFrame').srcdoc='';$('readerDialog').close();readerSession=null;render()}
window.addEventListener('message',e=>{
  if(e.source===$('readerFrame').contentWindow&&readerSession&&e.data?.type==='language-studio-close-reader'&&e.data.session===readerSession.session){closeReader();return}
  if(e.source!==$('readerFrame').contentWindow||!readerSession||e.data?.type!=='reading-studio-result'||e.data.session!==readerSession.session)return;
  const active=readerSession,r=e.data.record;
  if(!r||!Number.isFinite(r.cwpm)||!Number.isFinite(r.accuracy)||!['en-IN','hi-IN'].includes(r.language)||!['1','2','3','custom'].includes(r.level)||!Number.isFinite(r.seconds)||r.seconds<=0)return;
  const l=r.level==='custom'?active.level:Number(r.level);
  const record={id:active.session+'-'+String(r.readingId||'reading').slice(0,40),learner:active.learner,lang:r.language,level:l,mode:active.mode,domain:'fluency',form:'reader',at:new Date().toISOString(),responses:[],metrics:{correct:r.correct,error:r.error,skipped:r.skipped,attempted:r.attempted,cwpm:r.cwpm,accuracy:r.accuracy},seconds:r.seconds,passage:r.passage,customPassage:r.level==='custom',transcript:r.transcript||'',words:r.words||[]};
  if(r.passageText!=null)record.passageText=r.passageText;
  commitSession(record,(saved,detail)=>{
    const error=detail.rejected?detail.error:detail.recoveryStored?'Your reading result is saved for recovery. Open Saved work to retry or export it.':detail.deviceStored?'Your reading result has an encrypted copy on this device. Reconnect to save online.':CLOUD_MODE?'Reading is in this tab but has not reached the database. Export a recovery copy from Saved work before closing.':'Reading is available in the main tab but could not be saved to this browser. Download a backup from Saved work.';
    e.source.postMessage({type:'language-studio-saved',session:active.session,readingId:r.readingId,saved:saved||demo,error:saved?'':error},location.origin==='null'?'*':location.origin);
    if(detail.rejected){toast(error);return}
    if(readerSession===active){selected=record.learner;lang=record.lang;level=record.level;view='report';location.hash='report';render()}
    toast(demo?'Sample reading added for this demonstration only.':saved?'Reviewed reading saved in '+LANGUAGES[record.lang]+' · '+levelNames[record.level-1]+'.':error);
  });
});
function openLearner(){if(CLOUD_MODE&&!cloudCanManageLearners()){toast('Ask your administrator to add a learner.');return}if(demo){toast('Exit sample mode before adding a real learner.');return}$('learnerError').textContent='';$('learnerCode').value='';$('setupLanguage').value=lang;$('setupLevel').value=level;$('learnerDialog').showModal();$('learnerCode').focus()}
function sampleData(){const d=emptyData(),l={id:'sample-learner',code:'Sample · Reader 01'};d.learners=[l];const items=makeBank('en-IN',2,'A');d.sessions.push({id:'sample-baseline',learner:l.id,lang:'en-IN',level:2,mode:'diagnostic',form:'A',at:new Date(Date.now()-4*86400000).toISOString(),responses:items.map((q,i)=>{const score={sounds:1,decoding:i%2?0:2,vocabulary:2,listening:2,comprehension:i%2?0:1,speaking:1,writing:1}[q.domain];return {item:q.id,domain:q.domain,score,supported:score===1,response:q.kind==='choice'?q.options[score>0?q.answer:(q.answer+1)%3]:'Illustrative facilitator observation',note:'Sample data only',tag:q.tag}})});d.sessions.push({id:'sample-practice',learner:l.id,lang:'en-IN',level:2,mode:'practice',domain:'sounds',form:'A',at:new Date(Date.now()-2*86400000).toISOString(),responses:items.filter(q=>q.domain==='sounds').map(q=>({item:q.id,domain:q.domain,score:2,supported:false,response:'Illustrative practice response',note:'Sample',tag:q.tag}))});return d}
function enterDemo(){if(demo)return;original={data,selected,lang,level};data=sampleData();selected=data.learners[0].id;lang='en-IN';level=2;demo=true;view='overview';location.hash='overview';render()}
function exitDemo(){if(!demo)return;({data,selected,lang,level}=original);original=null;demo=false;render()}

function printReport() {
  const panels=[...$('workspace').querySelectorAll('details')],states=panels.map(d=>d.open);
  panels.forEach(d=>d.open=true);
  const restore=()=>{panels.forEach((d,i)=>d.open=states[i]);window.removeEventListener('afterprint',restore)};
  window.addEventListener('afterprint',restore);
  window.print();
}

let exportURL=null;
function download(content,name,type){if(exportURL)URL.revokeObjectURL(exportURL);exportURL=URL.createObjectURL(new Blob([content],{type}));$('exportFilename').textContent=name;$('exportText').value=content;$('exportDownload').href=exportURL;$('exportDownload').download=name;$('exportNotice').textContent='';if(!$('exportDialog').open)$('exportDialog').showModal()}
$('copyExport').onclick=async()=>{try{await navigator.clipboard.writeText($('exportText').value);$('exportNotice').textContent='Copied.'}catch{$('exportText').closest('details').open=true;$('exportText').focus();$('exportText').select();$('exportNotice').textContent='Select the text and copy it using your browser.'}};
function importBackupText(raw,done=()=>{}){
  const limit=CLOUD_MODE?12:10;if(backupBytes(raw)>limit*1024*1024)throw Error('Backup must be '+limit+' MiB or smaller.');
  const merged=mergeBackup(data,JSON.parse(raw));
  return persist(merged,(saved,detail)=>{
    if(saved){selected=selected||data.learners[0]?.id||'';$('pastedBackup').value='';dataDialogRefresh();render();$('importStatus').textContent='Backup merged. Existing records were preserved.'}
    else $('importStatus').textContent=detail.error||'Backup could not be saved. Your original records were preserved.';
    done(saved,detail);
  });
}
$('applyPastedBackup').onclick=()=>{try{importBackupText($('pastedBackup').value)}catch(e){$('importStatus').textContent=e.message||'Invalid backup.'}};

function dataDialog(){if(CLOUD_MODE){cloudDataControls();$('dataDialog').showModal();return}if(demo){toast('Exit sample mode to manage saved data.');return}$('dataStats').textContent=recoveryError?'Saved data could not be read. Your original data has not been overwritten.':`${data.learners.length} learners · ${data.sessions.length} sessions${hasUnsaved?' · Some changes are NOT saved':''} in this browser.`;$('deleteLearner').disabled=!learner();$('renameBtn').disabled=!learner();$('recoveryReset').hidden=!recoveryError;$('dataDialog').showModal()}
$('workspace').onclick=e=>{const a=e.target.closest('[data-action]');if(!a)return;const {action,domain}=a.dataset;if(action==='add')openLearner();else if(action==='demo')enterDemo();else if(action==='baseline')startRun('diagnostic');else if(action==='check')startRun('diagnostic',domain);else if(action==='recheck')startRun('recheck',domain);else if(action==='practice')startRun('practice',domain);else if(action==='reader')openReader();else if(action==='reader-practice')openReader('practice');else if(action==='skill')showSkill(domain);else if(action==='session'){const s=data.sessions.find(s=>s.id===domain);if(s)showSession(s)}else if(action==='csv'){if(CLOUD_MODE){cloudExport('csv',selected);return}download(sessionCSV(data,selected),(demo?'Sample-':'')+'Learner-Scores-All-Languages-and-Levels.csv','text/csv;charset=utf-8')}else if(action==='print')printReport()};
$('activityContent').onclick=e=>{const a=e.target.closest('[data-answer]');if(a&&run){if(run.feedback)return;run.chosen=Number(a.dataset.answer);saveDraft();document.querySelectorAll('[data-answer]').forEach(b=>b.setAttribute('aria-pressed',String(b===a)));const item=run.items[run.index];$('taskNext').disabled=!!item.audio&&!run.heard.has(item.audio);$('taskHint').textContent=taskHintText(item);return}const b=e.target.closest('[data-task]');if(!b)return;const t=b.dataset.task;if(t==='begin')renderTask();else if(t==='next')nextTask();else if(t==='back')previousTask();else if(t==='skip')nextTask(true);else if(t==='listen'&&run){const item=run.items[run.index];const activeRun=run;speak(item.audio,()=>{if(run===activeRun){run.heard.add(item.audio);const box=$('heardCheck');if(box){box.checked=true;box.dispatchEvent(new Event('change'))}}})}else if(t==='promptVoice'&&run){const q=run.items[run.index];speak([q.prompt,...(q.options||[])].join('. '))}else if(t==='stopVoice')speakStop();else if(t==='session'){const s=data.sessions.find(s=>s.id===b.dataset.session);if(s)showSession(s)}else if(t==='close')closeActivity();else if(t==='report'||t==='plan'){$('activityDialog').close();location.hash=t==='report'?'report':'practice'}else if(t==='followup'){$('activityDialog').close();startRun(b.dataset.follow==='check'?'diagnostic':b.dataset.follow,b.dataset.domain)}};
$('learnerForm').onsubmit=e=>{
  e.preventDefault();const code=$('learnerCode').value.trim();
  if(!code||code.length>50){$('learnerError').textContent='Enter a learner code of 1–50 characters.';return}
  if(data.learners.some(l=>codeKey(l.code)===codeKey(code))){$('learnerError').textContent='That learner code already exists.';return}
  const l={id:uid(),code},chosenLanguage=$('setupLanguage').value,chosenLevel=Number($('setupLevel').value);
  persist({...data,learners:[...data.learners,l]},(saved,detail)=>{
    if(saved){selected=l.id;lang=chosenLanguage;level=chosenLevel;$('learnerDialog').close();location.hash='overview';render()}
    else $('learnerError').textContent=detail.error||'Could not save this learner. Try again.';
  });
};
$('learnerSelect').onchange=e=>{selected=e.target.value;render()};$('langSelect').onchange=e=>{lang=e.target.value;speakStop();render()};$('levelSelect').onchange=e=>{level=Number(e.target.value);render()};$('addLearner').onclick=openLearner;$('demoBtn').onclick=enterDemo;$('exitDemo').onclick=exitDemo;$('helpBtn').onclick=()=>$('helpDialog').showModal();$('contextEdit').onclick=()=>$('learningDialog').showModal();$('dataBtn').onclick=dataDialog;document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());$('closeActivity').onclick=closeActivity;$('activityDialog').oncancel=e=>{e.preventDefault();closeActivity()};$('closeReader').onclick=closeReader;$('readerDialog').oncancel=e=>{e.preventDefault();closeReader()};
$('backupBtn').onclick=()=>CLOUD_MODE?cloudExport('json'):download(recoveryError?(storage.getItem(STORE_KEY)||'') : JSON.stringify(data,null,2),'Language-Studio-Backup.json','application/json');
$('allCsvBtn').onclick=()=>CLOUD_MODE?cloudExport('csv'):download(sessionCSV(data),'All-Language-Scores.csv','text/csv;charset=utf-8');
$('importFile').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  $('importStatus').textContent='';
  if(file.size>(CLOUD_MODE?12:10)*1024*1024){$('importStatus').textContent='Backup must be '+(CLOUD_MODE?12:10)+' MiB or smaller.';toast($('importStatus').textContent);return}
  try{importBackupText(await file.text(),saved=>{if(saved)toast('Backup merged. Existing records were preserved.')})}
  catch(error){$('importStatus').textContent=error.message||'This is not a valid Language Studio v2 backup.';toast($('importStatus').textContent)}
};
function dataDialogRefresh(){if(CLOUD_MODE){cloudDataControls();return}$('dataStats').textContent=`${data.learners.length} learners · ${data.sessions.length} sessions${hasUnsaved?' · Some changes are NOT saved':''} in this browser.`}
$('deleteLearner').onclick=()=>{
  if(!learner()||!confirm(`Delete ${learner().code} and all their saved sessions ${CLOUD_MODE?'in this workspace for everyone':'on this device'}?`))return;
  const id=selected,draft=readDraft();
  persist({...data,learners:data.learners.filter(l=>l.id!==id),sessions:data.sessions.filter(s=>s.learner!==id)},saved=>{
    if(saved){if(draft?.learner===id)clearDraft(draft.id,true);selected=data.learners[0]?.id||'';$('dataDialog').close();render()}
  });
};

const DRAFT_KEY='language-studio-draft-v2';
let inMemoryDraft=null,draftRevision=null,lastDraftContent='',draftSequence=0;
function draftIdentity(d){
  if(d.id)return d.id;
  // Older v2 drafts have no completion ID. Identical legacy snapshots must
  // resolve to the same ID when two tabs resume them before either writes.
  let a=2166136261,b=5381;for(const c of JSON.stringify(d)){a=Math.imul(a^c.charCodeAt(0),16777619)>>>0;b=(Math.imul(b,33)^c.charCodeAt(0))>>>0}
  return 'legacy-draft-'+a.toString(16)+'-'+b.toString(16);
}
function saveDraft(){
  if(!run||demo||run.index>=run.items.length)return;
  const d={...run,heard:[...run.heard]};delete d.items;delete d.revision;
  if(CLOUD_MODE)return cloudSaveDraft(d);
  const content=JSON.stringify(d);if(content===lastDraftContent&&!draftUnsaved)return;
  const active=run,sequence=++draftSequence;inMemoryDraft={...d,revision:draftRevision};draftUnsaved=true;pendingWrites++;updateUnsaved();let completed=false;
  const finish=()=>{if(completed)return false;completed=true;pendingWrites--;updateUnsaved();return true};
  const failed=error=>{if(!finish())return;toast(error.message||'This activity is in this tab only. Browser storage is unavailable.')};
  return withStorageLock(()=>{
    if(completed)return;
    try{
      const raw=storage.getItem(DRAFT_KEY),fresh=loadData(storage);let stored;try{stored=raw?JSON.parse(raw):null}catch{stored=null}
      if(raw&&!readDraft(stored,fresh)){storage.setItem(DRAFT_KEY+'-recovery',raw);stored=null;if(active.id===d.id)draftRevision=null}
      if(stored&&(draftIdentity(stored)!==d.id||(stored.revision||null)!==draftRevision)||!stored&&draftRevision){
        failed(Error('Another tab changed this activity. Your answers remain in this tab; finish here to save them, or discard this copy.'));return;
      }
      if(fresh.sessions.some(s=>s.id===d.id)){failed(Error('This activity was already completed in another tab. Its saved result will be kept.'));return}
      const revision=uid();storage.setItem(DRAFT_KEY,JSON.stringify({...d,revision}));draftRevision=revision;
      if(run===active)run.revision=revision;
      if(inMemoryDraft?.id===d.id)inMemoryDraft.revision=revision;
      lastDraftContent=content;if(sequence===draftSequence)draftUnsaved=false;finish();
    }catch(error){failed(Error('This activity is in this tab only. Browser storage is unavailable.'))}
  },failed);
}
function readDraft(candidate,available=data){
  if(demo)return null;
  try{
    const d=arguments.length?candidate:inMemoryDraft||(CLOUD_MODE?null:JSON.parse(storage.getItem(DRAFT_KEY)||'null'));
    if(!d||!available.learners.some(l=>l.id===d.learner)||!LANGUAGES[d.lang]||![1,2,3].includes(d.level)||
      !['practice','diagnostic','recheck'].includes(d.mode)||!['A','B'].includes(d.form)||
      !Number.isInteger(d.index)||!Array.isArray(d.answers)||!Array.isArray(d.heard)||
      d.id!=null&&(typeof d.id!=='string'||!d.id.trim()||d.id.length>120)||
      d.revision!=null&&(typeof d.revision!=='string'||d.revision.length>120))return null;
    if(d.domain&&(!domainById(d.domain)||d.domain==='fluency'))return null;
    const items=makeBank(d.lang,d.level,d.form).filter(i=>!d.domain||i.domain===d.domain);
    if(d.index<0||d.index>=items.length||d.answers.length>items.length)return null;
    if(!d.answers.every((r,i)=>r&&r.item===items[i].id&&r.domain===items[i].domain))return null;
    const item=items[d.index];
    if(d.chosen!==null&&(!Number.isInteger(d.chosen)||d.chosen<0||d.chosen>(item.kind==='choice'?item.options.length-1:2)))return null;
    if(typeof d.supported!=='boolean'||typeof d.feedback!=='boolean'||d.feedback&&d.mode!=='practice'||
      typeof d.note!=='string'||d.note.length>500||typeof d.evidence!=='string'||d.evidence.length>2000||
      d.heard.some(text=>typeof text!=='string'||!items.some(i=>i.audio===text)))return null;
    const s={id:'draft-validation',learner:d.learner,lang:d.lang,level:d.level,mode:d.mode,domain:d.domain||null,form:d.form,at:new Date().toISOString(),responses:d.answers};
    if(!validSession(s))return null;
    const id=draftIdentity(d);if(available.sessions.some(s=>s.id===id))return null;
    return {...d,id,items,heard:new Set(d.heard)};
  }catch{return null}
}
function clearDraft(id=readDraft()?.id,finished=false){
  if(demo)return;
  if(CLOUD_MODE){if(id)cloudClearDraft(id,finished);return}
  if(!id)return;
  if(inMemoryDraft?.id===id){inMemoryDraft=null;draftUnsaved=false;lastDraftContent='';draftSequence++}
  pendingWrites++;updateUnsaved();let complete=false;
  const done=()=>{if(complete)return;complete=true;pendingWrites--;updateUnsaved();renderResume()};
  return withStorageLock(()=>{
    try{
      const stored=JSON.parse(storage.getItem(DRAFT_KEY)||'null');
      if(stored&&draftIdentity(stored)===id){
        if(!finished&&(stored.revision||null)!==draftRevision&&draftRevision!==null){toast('The paused activity changed in another tab. Its newer answers were preserved.');done();return}
        storage.removeItem(DRAFT_KEY);
      }
      draftRevision=null;done();
    }catch{draftUnsaved=true;toast('The paused activity could not be removed from browser storage.');done()}
  },()=>{draftUnsaved=true;done()});
}
function renderResume(){
  const d=readDraft(),bar=$('resumeBanner');bar.hidden=!d;
  if(d)$('resumeDescription').textContent=`${data.learners.find(l=>l.id===d.learner)?.code} · ${LANGUAGES[d.lang]} · ${d.answers.length} responses recorded`;
}
function resumeRun(){
  activityGeneration++;
  const d=readDraft();if(!d){toast('No valid paused activity was found.');return}
  run=d;draftRevision=d.revision||null;lastDraftContent='';$('activityNotice').textContent='';selected=d.learner;lang=d.lang;level=d.level;render();
  $('activityMode').textContent=d.mode==='practice'?'GUIDED PRACTICE':'DIAGNOSTIC';
  renderTask();$('activityDialog').showModal();
}
function restoreAnswer(){
  const a=run.answers[run.index];
  run.chosen=a?.answer??null;run.supported=a?.supported||false;
  run.note=a?.note||'';run.evidence=a?.evidence||'';run.feedback=false;
}
function previousTask(){
  if(!run||run.index===0)return;
  const item=run.items[run.index];
  run.answers[run.index]={item:item.id,domain:item.domain,score:questionScore(item,run.chosen,run.supported),supported:item.kind==='observed'?run.chosen===1:run.supported,response:run.chosen===null?'':item.kind==='choice'?item.options[run.chosen]:(run.evidence||['Not demonstrated','With support','Independent'][run.chosen]),note:run.note,tag:item.tag,answer:run.chosen,evidence:run.evidence};
  run.index--;restoreAnswer();renderTask();
}
$('resumeBtn').onclick=resumeRun;
$('discardDraft').onclick=()=>{if(confirm('Discard the paused activity? Completed sessions are unaffected.')){clearDraft();renderResume()}};
$('renameBtn').onclick=()=>{
  if(!learner())return;
  $('renameCode').value=learner().code;$('renameDialog').showModal();
};
$('renameForm').onsubmit=e=>{
  e.preventDefault();const code=$('renameCode').value.trim();
  if(!code||code.length>50||data.learners.some(l=>l.id!==selected&&codeKey(l.code)===codeKey(code))){$('renameError').textContent='Enter a unique learner code.';return}
  const id=selected;persist({...data,learners:data.learners.map(l=>l.id===id?{...l,code}:l)},(saved,detail)=>{if(saved){$('renameDialog').close();render();dataDialogRefresh()}else $('renameError').textContent=detail.error||'Could not save the new code.'})
};
window.addEventListener('beforeunload',e=>{saveDraft();if(CLOUD_MODE?cloudHasTransientWork():hasUnsaved){e.preventDefault();e.returnValue=''}});
window.addEventListener('storage',e=>{
  if(CLOUD_MODE){if(e.key===null||e.key?.startsWith('language-studio-outbox-v1:')){updateUnsaved();render()}return}
  if(demo||recoveryError)return;
  if(e.key===DRAFT_KEY){
    if(run||inMemoryDraft){
      try{const stored=JSON.parse(storage.getItem(DRAFT_KEY)||'null');if((stored?.revision||null)!==draftRevision){draftUnsaved=true;updateUnsaved();toast('The paused activity changed in another tab. Your current answers remain in this tab.')}}catch{toast('The paused activity changed in another tab.')}
    }else renderResume();
    return;
  }
  if(e.key!==STORE_KEY||recordsUnsaved)return;
  try{
    const fresh=loadData(storage);data=fresh;durableData=fresh;
    if(!learner())selected=data.learners[0]?.id||'';
    render();
    if(run&&!fresh.learners.some(l=>l.id===run.learner))toast('This learner was deleted in another tab. This activity cannot be saved.');
    else if(run&&fresh.sessions.some(s=>s.id===run.id))toast('This activity was completed in another tab. Its saved result will be kept.');
  }catch{toast('Another tab changed the stored data. Reload only after exporting a backup.')}
});

window.addEventListener('hashchange',nav);window.addEventListener('pagehide',speakStop);nav();
$('importBtn').onclick=()=>$('importFile').click();
$('recoveryReset').onclick=()=>{
  if(!recoveryError||!confirm('Download a recovery copy, then reset the unreadable device data?'))return;
  const raw=storage.getItem(STORE_KEY)||'';
  download(raw,'Language-Studio-Recovery.json','application/json');
  withStorageLock(()=>{
    try{
      if((storage.getItem(STORE_KEY)||'')!==raw){toast('Saved data changed in another tab. Reload before resetting.');return}
      storage.setItem(STORE_KEY+'-recovery',raw);storage.setItem(STORE_KEY,JSON.stringify(emptyData()));recoveryError=false;data=emptyData();durableData=data;selected='';recordsUnsaved=false;updateUnsaved();$('dataDialog').close();render();toast('Unreadable data reset. Keep the recovery copy.');
    }catch{toast('Browser storage is still unavailable.')}
  },()=>toast('Browser storage is still unavailable.'));
};
