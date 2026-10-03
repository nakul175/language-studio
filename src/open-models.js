const deviceAI={worker:null,job:null,sequence:0,pendingByScope:new Map(),get pending(){return this.pendingByScope.get(aiScope()?.key)||null},set pending(value){const key=value?.key||aiScope()?.key;if(value)this.pendingByScope.set(key,value);else this.pendingByScope.delete(key)}};
function deviceMayClose(){return !deviceAI.pending||deviceAI.pending.key!==aiScope()?.key||confirm('AI feedback has not saved. Leave it in this tab for recovery?')}
function deviceRecover(){const pending=deviceAI.pending;if(!pending||pending.key!==aiScope()?.key)return;aiOpen(pending.payload.sessionId);openAction('retry-save')}
function stopDeviceModels(){if(deviceAI.job){clearTimeout(deviceAI.job.timer);deviceAI.job.reject(Error('Model processing was cancelled.'));deviceAI.job=null}deviceAI.worker?.terminate();deviceAI.worker=null}
function deviceModel(action,input,onProgress){
  if(deviceAI.job)return Promise.reject(Error('Wait for the current model step to finish.'));
  if(!window.Worker||!window.WebAssembly)return Promise.reject(Error('This browser cannot run the device models. Use a current desktop browser.'));
  if(!deviceAI.worker){
    deviceAI.worker=new Worker('/open-model-worker.js',{type:'module'});
    deviceAI.worker.onmessage=({data})=>{const job=deviceAI.job;if(!job||data.id!==job.id)return;if(data.progress){job.progress(data.progress);return}clearTimeout(job.timer);deviceAI.job=null;if(data.error)job.reject(Error(data.error));else job.resolve(data.result)};
    deviceAI.worker.onerror=()=>{const job=deviceAI.job;deviceAI.worker?.terminate();deviceAI.worker=null;if(job){clearTimeout(job.timer);deviceAI.job=null;job.reject(Error('The device model stopped. Model downloads may be blocked, or this device may not have enough memory.'))}};
  }
  return new Promise((resolve,reject)=>{const id=++deviceAI.sequence,timer=setTimeout(()=>{stopDeviceModels()},600000);deviceAI.job={id,resolve,reject,timer,progress:onProgress||(()=>{})};deviceAI.worker.postMessage({id,action,input})});
}
async function deviceSamples(audio){
  const AudioContext=window.AudioContext||window.webkitAudioContext;if(!AudioContext||!window.OfflineAudioContext)throw Error('Audio decoding is unavailable in this browser.');
  const bytes=Uint8Array.from(atob(audio.base64),c=>c.charCodeAt(0)),context=new AudioContext();
  try{
    const decoded=await context.decodeAudioData(bytes.buffer);if(!Number.isFinite(decoded.duration)||decoded.duration<=0||decoded.duration>120)throw Error('Use a recording no longer than two minutes.');
    const offline=new OfflineAudioContext(1,Math.ceil(decoded.duration*16000),16000),source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();const rendered=await offline.startRendering();return {samples:rendered.getChannelData(0),seconds:decoded.duration};
  }finally{await context.close()}
}
function deviceWav(samples,rate){
  const bytes=new ArrayBuffer(44+samples.length*2),view=new DataView(bytes),label=(at,s)=>[...s].forEach((c,i)=>view.setUint8(at+i,c.charCodeAt(0)));
  label(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);label(8,'WAVE');label(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);label(36,'data');view.setUint32(40,samples.length*2,true);for(let i=0;i<samples.length;i++)view.setInt16(44+i*2,samples[i],true);return new Blob([bytes],{type:'audio/wav'});
}
async function deviceVoice(state,notice,current){
  let voices=window.speechSynthesis?.getVoices()||[];if(window.speechSynthesis&&!voices.length){await new Promise(resolve=>{const timer=setTimeout(resolve,1500);speechSynthesis.addEventListener?.('voiceschanged',()=>{clearTimeout(timer);resolve()},{once:true})});voices=speechSynthesis.getVoices()}
  if(!current())return;
  const voice=voices.find(v=>v.lang.split('-')[0]===state.lang.split('-')[0]&&v.localService!==false);
  const a=state.activity,text=(a.skill==='listening'?a.passage+' ':'')+a.prompt;
  speakStop();
  if(voice){const speech=new SpeechSynthesisUtterance(text);speech.voice=voice;speech.lang=state.lang;speech.rate=.85;speechSynthesis.speak(speech);return}
  const result=await deviceModel('voice',{text,lang:state.lang},notice);if(!current())return;
  aiPlaybackClear();const audio=$('aiPlayback');audio.src=URL.createObjectURL(deviceWav(result.samples,result.sampleRate));audio.dataset.url=audio.src;audio.hidden=false;try{await audio.play()}catch{notice('The voice is ready. Press play to listen.')}
}
async function openAction(action){
  if(learningAI.busy||learningAI.recordPending||learningAI.recorder?.state==='recording')return;
  const scope=learningAI.scope;if(aiScope()?.key!==scope?.key)return;
  if(action==='export-pending'){if(deviceAI.pending)download(JSON.stringify(deviceAI.pending.payload,null,2),'Unsaved-AI-Response.json','application/json');return}
  if(action==='discard-pending'){if(deviceAI.pending&&confirm('Discard the unsaved response and its AI feedback? Download a copy first if you need it.')){deviceAI.pending=null;aiReset();aiReload()}return}
  if(action==='start'&&!$('aiPermission')?.checked){$('aiSessionNotice').textContent='Confirm permission before starting.';return}
  const generation=learningAI.generation,s=learningAI.state;
  const current=()=>generation===learningAI.generation&&aiScope()?.key===scope.key;
  const notice=t=>{if(current())$('aiSessionNotice').textContent=t};
  if(action==='start'&&deviceAI.pending){notice('Save the waiting result for this learner before starting another session.');return}
  aiLock(true);
  try{
    if(action==='voice'){await deviceVoice(s,notice,current);notice('Voice ready. Use play if it did not start automatically.');return}
    if(action==='delete'){
      if(deviceAI.pending)throw Error('Save the waiting result before deleting this session.');
      if(!confirm('Delete this AI session and its saved responses?'))return;
      const result=await aiFetch(scope,{action:'delete',sessionId:s.id,version:s.version,requestId:uid(),lang:scope.lang,level:scope.level,consent:true});if(!current())return;learningAI.sessions=learningAI.sessions.filter(x=>x.id!==result.deleted);aiReset();aiHome();return;
    }
    let payload;
    if(action==='start'){
      notice('Downloading the open-source language model. First use can take several minutes.');
      await deviceModel('prepare',{},notice);if(!current())return;
      payload={action:'start',requestId:uid(),lang:scope.lang,level:scope.level,consent:true};
    }else if(action==='retry-save'){
      if(!deviceAI.pending||deviceAI.pending.key!==scope.key)throw Error('No unsaved AI feedback is available.');payload=deviceAI.pending.payload;
    }else{
      if(deviceAI.pending?.key===scope.key)throw Error('Save the previous AI feedback before submitting another response.');
      let answer=$('aiAnswer')?.value.trim()||'',source='typed',seconds;
      const supported=$('aiSupported').checked;
      if(learningAI.audio){
        notice('Preparing the recording…');const decoded=await deviceSamples(learningAI.audio);if(!current())return;
        seconds=decoded.seconds;const transcript=await deviceModel('transcribe',{samples:decoded.samples,lang:scope.lang},notice);if(!current())return;answer=transcript.text;source='speech';
      }
      if(!answer)throw Error('Record or type the learner’s response.');
      const assessment=await deviceModel('assess',{activity:s.activity,response:answer,supported,source,lang:scope.lang,level:scope.level,stage:s.answers.length,checkCount:s.checkCount,totalSteps:s.totalSteps,checks:s.answers.filter(a=>a.stage<s.checkCount&&a.score!==null).map(a=>({activity:a.activity,score:a.score})),fallbackPractice:s.answers.find(a=>a.activity.skill==='comprehension')?.activity},notice);if(!current())return;
      payload={action:'answer',requestId:uid(),lang:scope.lang,level:scope.level,consent:true,sessionId:s.id,version:s.version,answer,supported,source,assessment,...(seconds?{seconds}:{})};
    }
    if(!current())return;
    deviceAI.pending={key:scope.key,payload};notice('Saving the response and next activity…');
    const result=await aiFetch(scope,payload);if(!current())return;
    deviceAI.pending=null;aiPlaybackClear();aiAudioClear();learningAI.state=result.state;learningAI.sessions=[result.state,...learningAI.sessions.filter(x=>x.id!==result.state.id)].slice(0,50);aiDraw();aiHome();
  }catch(error){
    if(current()){
      notice(error.message);
      if(deviceAI.pending?.key===scope.key){const area=$('aiSessionContent');if(!$('aiRetryFeedback'))area.insertAdjacentHTML?area.insertAdjacentHTML('beforeend','<div class="ai-feedback"><strong>AI feedback is ready but has not saved.</strong><p>Keep this tab open. Retry saving without running the model again.</p><button id="aiRetryFeedback" class="button primary" data-ai="retry-save">Retry saving feedback</button></div>'):area.innerHTML+='<button id="aiRetryFeedback" data-ai="retry-save">Retry saving feedback</button>';aiHome()}
    }
  }finally{if(current())aiLock(false)}
}
window.openModelsReady=true;
