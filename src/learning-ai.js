const learningAI={key:null,scope:null,sessions:[],configured:false,loading:false,error:'',state:null,busy:false,generation:0,controller:null,recorder:null,stream:null,audio:null,audioUrl:null,recordPending:false};
function aiScope(){return CLOUD_MODE&&!demo&&cloudState.status==='ready'&&learner()?{key:JSON.stringify([cloudState.user.id,cloudState.workspaceId,selected,lang,level]),user:cloudState.user.id,w:cloudState.workspaceId,lid:selected,lang,level}:null}
function aiAudioClear(){const audio=$('aiRecording');if(audio){audio.pause?.();audio.removeAttribute('src');audio.hidden=true}if(learningAI.audioUrl)URL.revokeObjectURL(learningAI.audioUrl);learningAI.audioUrl=null;learningAI.audio=null}
function aiStop(){learningAI.recorder?.state==='recording'&&learningAI.recorder.stop();learningAI.stream?.getTracks().forEach(t=>t.stop());learningAI.stream=null}
function aiPlaybackClear(){speakStop();const audio=$('aiPlayback');if(audio){audio.pause?.();if(audio.dataset.url){URL.revokeObjectURL(audio.dataset.url);delete audio.dataset.url}audio.removeAttribute('src')}}
function aiReset(){if(window.openModelsReady)stopDeviceModels();learningAI.generation++;learningAI.controller?.abort();aiStop();aiAudioClear();learningAI.recordPending=false;learningAI.busy=false;learningAI.state=null;if($('aiSessionDialog')?.open)$('aiSessionDialog').close();aiPlaybackClear();if($('aiSessionContent'))$('aiSessionContent').innerHTML='';speakStop()}
async function aiFetch(scope,payload,binary=false){
  const controller=new AbortController();learningAI.controller=controller;const timeout=setTimeout(()=>controller.abort(),100000);
  try{
    const res=await fetch('/api/workspaces/'+encodeURIComponent(scope.w)+'/learners/'+encodeURIComponent(scope.lid)+(window.openModelsReady?'/open-session':'/ai-session'),{method:payload?'POST':'GET',credentials:'same-origin',headers:{'X-Language-Studio-Account':scope.user,...(payload?{'Content-Type':'application/json','X-Language-Studio':'1'}:{})},body:payload?JSON.stringify(payload):undefined,signal:controller.signal});
    if(!res.ok){const r=await res.json();throw Error(r.error||'The session could not be loaded.')}
    return binary?await res.blob():await res.json();
  }catch(error){if(error.name==='AbortError')throw Error('The connection timed out. Reopen this session to check its saved state.');throw error}finally{clearTimeout(timeout);if(learningAI.controller===controller)learningAI.controller=null}
}
function aiHome(){
  const scope=aiScope(),container=$('aiHome');if(!container)return;
  if(!scope){container.hidden=true;if(learningAI.key){aiReset();learningAI.key=null;learningAI.sessions=[]}return}
  container.hidden=!['overview','report'].includes(view);
  if(scope.key!==learningAI.key){aiReset();learningAI.key=scope.key;learningAI.scope=scope;learningAI.sessions=[];learningAI.configured=false;learningAI.error='';aiReload();return}
  const sessions=learningAI.sessions.filter(s=>s.lang===scope.lang&&s.level===scope.level),pending=sessions.find(s=>!s.completed);
  container.innerHTML='<div class="ai-heading"><div><span class="eyebrow">'+(view==='report'?'AI LEARNING RECORD':'TODAY’S LEARNING')+'</span><h1>'+(view==='report'?'AI session progress':'Learn together. AI guides the session.')+'</h1><p>Reading, understanding, listening, speaking and writing. AI checks each response and prepares targeted practice.</p></div></div>'+
    (learningAI.loading?'<p role="status">Opening AI sessions…</p>':learningAI.error?'<p role="alert">'+esc(learningAI.error)+'</p><button class="button secondary" data-ai="reload">Reload AI sessions</button>':!learningAI.configured?'<div class="ai-unavailable" role="status"><strong>AI is unavailable in this browser</strong><p>Use a current browser with Web Workers and WebAssembly to run the open-source models.</p></div>':'<div class="button-row"><button class="button primary" data-ai="open" data-id="'+esc(pending?.id||'')+'">'+(pending?'Continue AI session':'Start AI session')+'</button>'+(pending?'<button class="button secondary" data-ai="open">Start a new session</button>':'')+'</div><p class="small">7 short checks + 2 practice activities · each completed step saves automatically</p>')+
    (window.openModelsReady&&deviceAI.pending?.key===scope.key?'<div class="ai-feedback"><strong>One AI result is waiting to save</strong><p>It remains in this tab. Save it before closing the browser.</p><button class="button primary" data-ai="recover">Save waiting result</button><button class="button secondary" data-ai="export-pending">Download unsaved response</button><button class="button subtle" data-ai="discard-pending">Discard unsaved response</button></div>':'')+
    (sessions.length?'<details class="section-gap"'+(view==='report'?' open':'')+'><summary>Saved AI sessions ('+sessions.length+')</summary>'+sessions.map(s=>'<button class="ai-history" data-ai="open" data-id="'+esc(s.id)+'"><span><strong>'+new Date(s.updatedAt).toLocaleDateString()+' · '+(s.completed?'Completed':s.answers.length+' of '+(s.totalSteps||7)+' responses saved')+'</strong><span>'+esc(s.report?.summary||'Session ready')+'</span></span><span>Open</span></button>').join('')+'</details>':'');
}
async function aiReload(){
  const scope=aiScope();if(!scope)return;const generation=learningAI.generation;learningAI.loading=true;aiHome();
  try{const r=await aiFetch(scope);if(generation!==learningAI.generation||aiScope()?.key!==scope.key)return;learningAI.sessions=r.sessions;learningAI.configured=r.configured&&(!window.openModelsReady||!!(window.Worker&&window.WebAssembly));learningAI.error=''}catch(e){if(generation===learningAI.generation)learningAI.error=e.message}finally{if(generation===learningAI.generation){learningAI.loading=false;aiHome()}}
}
function aiOpen(id){
  aiReset();const scope=aiScope();if(!scope)return;learningAI.scope=scope;learningAI.state=learningAI.sessions.find(s=>s.id===id)||null;
  $('aiSessionDialog').showModal();aiDraw();
}
function aiReport(state){
  const r=state.report;return '<section class="ai-feedback"><h3>'+ (state.completed?'Learning summary':'Latest feedback')+'</h3><p>'+esc(r?.summary||'')+'</p>'+(r?.strengths?.length?'<h4>Strengths observed</h4><ul>'+r.strengths.map(t=>'<li>'+esc(t)+'</li>').join('')+'</ul>':'')+(r?.gaps?.length?'<h4>Next to practise</h4><ul>'+r.gaps.map(t=>'<li>'+esc(t)+'</li>').join('')+'</ul>':'')+(r?.unassessed?.length?'<h4>Not scored</h4><p>'+esc(r.unassessed.join(', '))+'</p>':'')+'<p class="small">AI feedback is provisional. These activities have not been validated as a diagnostic assessment.</p></section>';
}
function aiExport(state){
  const body=aiReport(state)+aiEvidence(state).replace('<details class="section-gap">','<details class="section-gap" open>');
  const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Language Studio learning report</title><style>body{max-width:800px;margin:32px auto;padding:0 20px;font:17px/1.6 system-ui;color:#182923}h1,h3,h4{line-height:1.3}.ai-evidence{border-top:1px solid #aaa;margin-top:24px;padding-top:12px;break-inside:avoid}.small{font-size:14px}summary{font-weight:bold}@media print{body{margin:0}}</style><h1>Language Studio learning report</h1><p>'+esc(learner()?.code||'Learner')+' · '+esc(state.lang)+' · Level '+esc(state.level)+' · '+esc(new Date(state.updatedAt).toLocaleDateString())+'</p>'+body+'<p>Models: '+esc(Object.values(state.models||{}).join(' · '))+'</p></html>';
  download(html,'AI-Learning-Report.html','text/html');
}
function aiDraw(){
  const s=learningAI.state,area=$('aiSessionContent');if(!area)return;
  $('aiSessionTitle').textContent=s?.completed?'Your learning summary':'Learning with '+(learner()?.code||'your learner');
  $('aiSessionNotice').textContent='';
  if(!s){area.innerHTML='<h3>One guided session</h3><p>AI will guide seven short language checks and two practice activities. Language understanding and speech recognition run on this device. First use downloads several hundred megabytes of model files; a desktop browser is recommended.</p><p>You stay with the child. They can speak their answers or type them; writing tasks require typing.</p><label class="ai-check"><input id="aiPermission" type="checkbox"> I have permission to process this learner’s recordings on this device and save their responses and AI feedback to this workspace.</label><p class="small">Responses and AI feedback are saved privately to your account in this workspace. Audio stays on this device. Public model files download from Hugging Face and jsDelivr; recordings are not sent to them.</p><button class="button primary" data-ai="begin"'+(!learningAI.configured?' disabled':'')+'>Begin session</button>';return}
  if(s.completed){area.innerHTML=aiReport(s)+'<p>All completed responses are saved. Practice results remain separate from the learning checks.</p>'+aiEvidence(s)+'<div class="button-row"><button class="button primary" data-ai="close">Done</button><button class="button secondary" data-ai="export">Download AI report</button><button class="button secondary" data-ai="json">Download session data</button><button class="button subtle" data-ai="delete">Delete session</button></div>';return}
  const a=s.activity,step=s.answers.length,previous=s.answers.at(-1),checks=s.checkCount||5;
  area.innerHTML='<p class="eyebrow">'+(step<checks?'CHECK '+(step+1)+' OF '+checks:'PRACTICE '+(step-checks+1)+' OF 2')+' · '+esc(skillName(a.skill))+'</p>'+
    (previous?'<div class="ai-feedback" role="status"><strong>Saved · '+esc(skillName(previous.activity.skill))+'</strong><p>'+esc(previous.feedback)+'</p>'+(previous.uncertain?'<p>AI could not score this response reliably. It remains unassessed in your record.</p>':'')+'</div>':'')+
    (a.passage&&a.skill!=='listening'?'<div class="ai-passage" lang="'+esc(s.lang)+'">'+esc(a.passage)+'</div>':'')+
    '<h3 lang="'+esc(s.lang)+'">'+esc(a.prompt)+'</h3><button class="button secondary" data-ai="voice">'+(a.skill==='listening'?'Listen to the story and question':'Hear the question')+'</button><p class="small">Spoken instructions</p><audio id="aiPlayback" controls hidden></audio>'+
    (step>=checks?'<details id="aiHint"><summary>Get a hint</summary><p>'+esc(a.hint)+'</p></details>':'')+
    (a.skill!=='writing'?'<div class="ai-recorder"><button class="button secondary" id="aiRecord" data-ai="record">Record response</button><label class="button secondary ai-upload">Upload recording<input id="aiAudioFile" type="file" accept="audio/webm,audio/mp4,audio/mpeg,audio/wav,audio/ogg" hidden></label><p class="small">Up to 2 minutes · 4 MB</p><audio id="aiRecording" controls hidden></audio></div>':'')+
    (!['fluency','decoding','speaking'].includes(a.skill)?'<label for="aiAnswer">'+(a.skill==='writing'?'Type the learner’s writing exactly':'Or type the learner’s exact answer')+'</label><textarea id="aiAnswer" rows="3" maxlength="3000" lang="'+esc(s.lang)+'"></textarea>':'')+
    '<label class="ai-check"><input id="aiSupported" type="checkbox"> The learner received help with this response</label><div class="button-row"><button class="button primary" id="aiContinue" data-ai="answer">Assess and continue</button><button class="button subtle" data-ai="close">Exit session</button><button class="button subtle" data-ai="delete">Delete session</button></div><p class="small">AI feedback saves automatically. An unfinished response stays only in this tab.</p>';
  $('aiAudioFile')?.addEventListener?.('change',async e=>{try{await aiFile(e.target.files?.[0])}catch(error){$('aiSessionNotice').textContent=error.message}});
  $('aiHint')?.addEventListener?.('toggle',()=>{if($('aiHint').open)$('aiSupported').checked=true});
}
function aiReadingEvidence(answer){
  const r=answer.reading,m=r?.metrics;if(!m)return '';
  return '<p><strong>Transcript comparison:</strong> '+esc(m.correct)+' matching words, '+esc(m.error)+' substitutions, '+esc(m.skipped)+' omissions; '+esc(m.cwpm)+' matching words per minute across '+esc(Math.round(r.seconds))+' seconds.</p><p class="small">Automatic transcript estimates only. Recognition errors, silence and re-reading can change these numbers; they are not validated oral-reading scores.</p>';
}
function aiEvidence(s){return '<details class="section-gap"><summary>Responses and assessment evidence</summary>'+s.answers.map(a=>'<article class="ai-evidence"><h4>'+esc(skillName(a.activity.skill))+' · '+(a.stage<(s.checkCount||5)?'Check':'Practice')+'</h4><p>'+esc(a.activity.prompt)+'</p><p><strong>Response:</strong> '+esc(a.response)+'</p><p>'+esc(a.feedback)+'</p><p class="small">'+(a.score===null?'Unassessed':a.score===2?'AI: independent response':a.score===1?'AI: partial or supported response':'AI: not demonstrated')+' · '+esc(a.source)+'</p>'+aiReadingEvidence(a)+'</article>').join('')+'<p class="small">These are AI interpretations of limited evidence, not grades or a diagnosis. Speech transcription does not assess phoneme accuracy, pronunciation or prosody. This tool does not assess handwriting.</p></details>'}
function aiLock(locked){learningAI.busy=locked;$('aiSessionContent').querySelectorAll('button,input,textarea').forEach(e=>e.disabled=locked)}
async function aiAction(action){
  if(window.openModelsReady)return openAction(action);
  if(learningAI.busy||learningAI.recordPending||learningAI.recorder?.state==='recording')return;
  const scope=learningAI.scope;if(aiScope()?.key!==scope?.key)return;
  if(action==='start'&&!$('aiPermission')?.checked){$('aiSessionNotice').textContent='Confirm permission before starting an AI session.';return}
  const generation=learningAI.generation,s=learningAI.state,payload={action,lang:scope.lang,level:scope.level,requestId:uid(),consent:true,...(s?{sessionId:s.id,version:s.version}:{})};
  if(action==='answer'){payload.answer=$('aiAnswer')?.value||'';payload.supported=$('aiSupported').checked;if(learningAI.audio)payload.audio=learningAI.audio;if(!payload.audio&&!payload.answer.trim()){$('aiSessionNotice').textContent='Record or type a response first.';return}}
  aiLock(true);$('aiSessionNotice').textContent=action==='voice'?'Preparing the voice…':'AI is preparing the next step…';
  try{
    const r=await aiFetch(scope,payload,action==='voice');if(generation!==learningAI.generation||aiScope()?.key!==scope.key)return;
    if(action==='voice'){const audio=$('aiPlayback');if(audio.dataset.url)URL.revokeObjectURL(audio.dataset.url);audio.src=URL.createObjectURL(r);audio.dataset.url=audio.src;audio.hidden=false;try{await audio.play()}catch{}$('aiSessionNotice').textContent='Voice ready. Press play if it did not start.';return}
    aiPlaybackClear();aiAudioClear();learningAI.state=r.state;learningAI.sessions=[r.state,...learningAI.sessions.filter(x=>x.id!==r.state.id)].slice(0,20);aiDraw();aiHome();
  }catch(error){if(generation===learningAI.generation)$('aiSessionNotice').textContent=error.message+' Exit and reopen the session to retrieve saved progress.'}finally{if(generation===learningAI.generation)aiLock(false)}
}
async function aiFile(file){
  aiAudioClear();if(!file)return;const type=file.type.split(';')[0];if(!['audio/webm','audio/mp4','audio/mpeg','audio/wav','audio/ogg','audio/x-wav'].includes(type)||file.size>4*1024*1024||!file.size)throw Error('Choose an audio file up to 4 MB.');
  const generation=learningAI.generation,version=learningAI.state?.version,bytes=new Uint8Array(await file.arrayBuffer());if(generation!==learningAI.generation||version!==learningAI.state?.version)return;let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));learningAI.audio={type,base64:btoa(binary)};learningAI.audioUrl=URL.createObjectURL(file);$('aiRecording').src=learningAI.audioUrl;$('aiRecording').hidden=false;$('aiSessionNotice').textContent='Recording ready for AI assessment.';
}
async function aiRecord(){
  if(learningAI.recorder?.state==='recording'){aiStop();return}
  if(learningAI.busy||learningAI.recordPending)return;
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){$('aiSessionNotice').textContent='Recording is unavailable in this browser. Upload an audio file.';return}
  const generation=learningAI.generation;learningAI.recordPending=true;aiLock(true);
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});if(generation!==learningAI.generation){stream.getTracks().forEach(t=>t.stop());return}
    learningAI.stream=stream;aiPlaybackClear();aiAudioClear();const recorder=new MediaRecorder(stream),chunks=[];let bytes=0,failed=false;
    learningAI.recorder=recorder;const timer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop()},120000);
    recorder.ondataavailable=e=>{bytes+=e.data.size;if(bytes>4*1024*1024){failed=true;if(recorder.state==='recording')recorder.stop()}else chunks.push(e.data)};
    recorder.onerror=()=>{failed=true;aiStop()};
    recorder.onstop=async()=>{clearTimeout(timer);stream.getTracks().forEach(t=>t.stop());if(generation!==learningAI.generation)return;learningAI.recorder=null;aiLock(false);$('aiRecord').textContent='Record again';try{if(failed)throw Error('Recording failed or exceeded 4 MB. Record a shorter response.');await aiFile(new Blob(chunks,{type:recorder.mimeType}))}catch(error){$('aiSessionNotice').textContent=error.message}};
    recorder.start(1000);$('aiRecord').disabled=false;$('aiRecord').textContent='Stop recording';$('aiSessionNotice').textContent='Listening… Stop when the learner finishes.';
  }catch(error){learningAI.stream?.getTracks().forEach(t=>t.stop());if(generation===learningAI.generation){aiLock(false);$('aiSessionNotice').textContent='Microphone access failed. Upload an audio file or check browser permissions.'}}finally{if(generation===learningAI.generation)learningAI.recordPending=false}
}
document.addEventListener?.('click',e=>{const b=e.target.closest('[data-ai]');if(!b)return;const action=b.dataset.ai;if(action==='open')aiOpen(b.dataset.id);else if(action==='begin')aiAction('start');else if(['answer','voice','delete','retry-save','export-pending','discard-pending'].includes(action))aiAction(action);else if(action==='export'&&learningAI.state)aiExport(learningAI.state);else if(action==='json'&&learningAI.state)download(JSON.stringify(learningAI.state,null,2),'AI-Learning-Session.json','application/json');else if(action==='record')aiRecord();else if(action==='reload')aiReload();else if(action==='recover'&&window.openModelsReady)deviceRecover();else if(action==='close'){if(window.openModelsReady&&!deviceMayClose())return;aiReset();aiReload()}});
$('aiSessionDialog').addEventListener?.('cancel',e=>{if(window.openModelsReady&&!deviceMayClose()){e.preventDefault();return}aiReset();aiReload()});
window.addEventListener('pagehide',aiReset);
window.addEventListener('beforeunload',e=>{if(window.openModelsReady&&deviceAI.pendingByScope.size){e.preventDefault();e.returnValue=''}});
window.learningAiReady=true;aiHome();
