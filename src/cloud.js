// Account and database integration. Browser storage is read only when an adult
// explicitly chooses to import their earlier, device-local records.
async function cloudRequest(path,method='GET',payload){
  if(navigator.onLine===false){const error=Error('You are offline. Reconnect to save online.');error.code='OFFLINE';throw error}
  const controller=new AbortController();let timer;
  const headers=method==='GET'?{}:{'Content-Type':'application/json','X-Language-Studio':'1'};
  if(cloudState.user&&path!=='/me'&&!path.startsWith('/me?'))headers['X-Language-Studio-Account']=cloudState.user.id;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=Error('The connection timed out. Your pending result can be retried.');error.code='NETWORK_TIMEOUT';reject(error);controller.abort()},20000)});
  try{
    const response=await Promise.race([fetch('/api'+path,{method,signal:controller.signal,credentials:'same-origin',cache:'no-store',headers,body:payload===undefined?undefined:JSON.stringify(payload)}),timeout]);
    let result;try{result=await Promise.race([response.json(),timeout])}catch(error){if(error.code==='NETWORK_TIMEOUT')throw error;throw Error('The server is unavailable. Keep this tab open and try again.')}
    if(!response.ok){const error=Error(result.error||'Your request could not be completed.');error.status=response.status;error.code=result.code;throw error}
    return result;
  }finally{clearTimeout(timer)}
}
function cloudPath(suffix){return '/workspaces/'+encodeURIComponent(cloudState.workspaceId)+suffix}
function cloudCanManageLearners(){return !CLOUD_MODE||cloudState.role==='admin'||cloudState.role==='teacher'}
function cloudAdopt(result){
  if(!validateBackup(result.data))throw Error('The server returned unreadable records. Your current work has been kept.');
  data={...result.data,sessions:[]};durableData=data;cloudState.progress=null;cloudState.progressKey=null;cloudState.total=result.total??result.data.sessions.length;cloudState.revision=result.revision;cloudState.role=result.role;cloudState.workspaceName=result.name;
  if(!learner())selected=data.learners[0]?.id||'';
  cloudState.capacity=result.capacity||null;
  for(const [id,entry] of cloudState.recoveries)if(result.data.sessions.some(s=>s.id===id)||!data.learners.some(l=>l.id===entry.session.learner))cloudState.recoveries.delete(id);
  for(const s of result.recovery||[]){
    if(!validSession(s)||!data.learners.some(l=>l.id===s.learner))throw Error('A recovery result could not be read.');
    if(!data.sessions.some(r=>r.id===s.id))cloudState.recoveries.set(s.id,{...cloudState.recoveries.get(s.id),session:s,stored:true});
  }
  recordsUnsaved=cloudState.recoveries.size>0;
}
function cloudGate(){
  if(!CLOUD_MODE)return false;
  const ready=cloudState.status==='ready';
  $('dataBtn').hidden=!ready;$('accountBtn').hidden=!cloudState.user;
  $('addLearner').hidden=!cloudCanManageLearners();
  $('demoBtn').hidden=true;
  $('cloudSaveStatus').textContent=ready?hasUnsaved?'Changes waiting to save — keep this tab open':'Saved to '+cloudState.workspaceName:'For teachers and parents · adult-guided learning';
  if(ready){updateUnsaved();return false}
  $('learnerBar').hidden=true;$('resumeBanner').hidden=true;$('demoBanner').hidden=true;$('cloudRecoveryBanner').hidden=true;$('cloudCapacityNotice').hidden=true;
  document.querySelector('.main-nav').hidden=true;
  let contents='';
  if(cloudState.status==='loading')contents='<h1>Opening your learning space…</h1><p role="status">Loading your account and saved work.</p>';
  else if(cloudState.status==='anonymous')contents='<span class="eyebrow">A LITTLE PRACTICE, EVERY DAY</span><h1>Help their language skills grow.</h1><p>Check reading, explore stories and find the next useful practice activity. Keep each learner’s progress together.</p><a class="button primary" target="_top" href="'+esc(cloudState.signIn)+'">Sign in with ChatGPT</a><p class="small">For teachers and parents. Use your adult account; children do not need an account.</p>';
  else if(cloudState.status==='setup')contents='<span class="eyebrow">WELCOME TO LANGUAGE STUDIO</span><h1>Your learners. One simple space.</h1><p>Create a space for your classroom or family. You can invite other teachers and parents later.</p>'+cloudWorkspaceForm()+'<p class="small">Expecting an invitation? Open the invitation link shared by your teacher or administrator.</p>';
  else if(cloudState.status==='invitation')contents='<span class="eyebrow">YOU’RE INVITED</span><h1>Join '+esc(cloudState.invitation.workspaceName)+'</h1><p>You will join as a <strong>'+esc(cloudRoleName(cloudState.invitation.role))+'</strong> using '+esc(cloudState.user.email)+'.</p><button class="button primary" data-cloud="accept">Accept invitation</button><button class="button subtle" data-cloud="skip-invite">Back to my workspaces</button><p id="cloudGateError" role="alert"></p>';
  else contents='<h1>We couldn’t open your workspace</h1><p role="alert">'+esc(cloudState.error)+'</p><div class="button-row"><button class="button primary" data-cloud="retry">Try again</button>'+(cloudState.user?'<button class="button secondary" data-cloud="skip-invite">My workspaces</button><a class="button subtle" target="_top" href="'+esc(cloudState.signOut)+'">Sign out</a>':'')+'</div>';
  $('workspace').innerHTML='<section class="account-welcome"><div class="welcome-symbol" aria-hidden="true">L<span>•</span></div>'+contents+'</section>';
  return true;
}
function cloudWorkspaceForm(){return '<form data-cloud-form="workspace"><label for="workspaceName">Name your space</label><input id="workspaceName" name="workspaceName" required maxlength="80" placeholder="e.g. Class 2 · Oak School or Our family"><p class="small">Only people you give access to can see learner records.</p><button class="button primary" type="submit">Create learning space</button><p data-form-error role="alert"></p></form>'}
function cloudRoleName(role){return {admin:'Administrator',teacher:'Teacher',parent:'Parent'}[role]||role}
async function cloudInit(preferred){
  cloudState.status='loading';render();
  try{
    const me=await cloudRequest('/me?returnTo='+encodeURIComponent(location.pathname+location.search));
    Object.assign(cloudState,me);
    if(!me.user){cloudState.device?.forgetKey();cloudState.device=null;cloudState.deviceUser=null;cloudState.status='anonymous';data=emptyData();durableData=data;cloudState.recoveries.clear();recordsUnsaved=false;render();return}
    cloudPrepareDevice();
    const token=new URLSearchParams(location.search).get('invite');
    if(token){cloudState.inviteToken=token;cloudState.invitation=await cloudRequest('/invitations/'+encodeURIComponent(token));cloudState.status='invitation';render();return}
    let remembered;try{remembered=storage.getItem('language-studio-space:'+me.user.id)}catch{}
    const space=me.workspaces.find(w=>w.id===(preferred||remembered))||me.workspaces[0];
    if(!space){cloudState.status='setup';render();return}
    await cloudSelectWorkspace(space.id);
  }catch(error){cloudState.status='error';cloudState.error=error.message;render()}
}
async function cloudSelectWorkspace(id){
  cloudState.status='loading';cloudState.progressGeneration=(cloudState.progressGeneration||0)+1;render();
  const result=await cloudRequest('/workspaces/'+encodeURIComponent(id)+'/bootstrap');
  const recoveryScope=cloudState.user.id+':'+id;if(cloudState.recoveryScope!==recoveryScope){cloudState.recoveries.clear();cloudState.completedIds.clear();cloudState.recoveryScope=recoveryScope}
  cloudState.workspaceId=id;cloudAdopt(result);inMemoryDraft=result.draft;cloudState.savedDraft=result.draft?{id:result.draft.id,revision:result.draft.revision}:null;draftRevision=result.draft?.revision||null;lastDraftContent='';
  recordsUnsaved=cloudState.recoveries.size>0;draftUnsaved=false;updateUnsaved();cloudState.status='ready';
  try{storage.setItem('language-studio-space:'+cloudState.user.id,id)}catch{}
  document.querySelector('.main-nav').hidden=false;render();await cloudState.progressPromise;await cloudRestoreDevice();await cloudAutoSync(true);
}
// Learner administration and explicit imports still use the compatible full
// snapshot protocol. Reconcile against a fresh snapshot, never the paged cache.
function cloudPersist(next,done){
  if(cloudState.status!=='ready'||!validateBackup(next)){done(false,{rejected:true,error:'Open your workspace and check these records.'});return false}
  const base=durableData,space=cloudState.workspaceId;pendingWrites++;updateUnsaved();
  const task=async()=>{
    try{
      for(let attempt=0;attempt<3;attempt++){
        const fresh=await cloudRequest('/workspaces/'+encodeURIComponent(space)+'/data');
        const merged=reconcileChanges(base,next,fresh.data),payload={revision:fresh.revision,operationId:uid(),data:merged};
        try{
          let result;
          try{result=await cloudRequest('/workspaces/'+encodeURIComponent(space)+'/changes','POST',payload)}
          catch(error){if(error.status)throw error;result=await cloudRequest('/workspaces/'+encodeURIComponent(space)+'/changes','POST',payload)}
          if(cloudState.workspaceId!==space)throw Error('The workspace changed before this save completed.');
          cloudAdopt(result);pendingWrites--;updateUnsaved();done(true,{previous:fresh.data});render();await cloudState.progressPromise;return;
        }catch(error){if(error.status!==409||attempt===2)throw error}
      }
    }catch(error){
      pendingWrites--;updateUnsaved();toast(error.message);done(false,{error:error.message,rejected:true});
      if([401,403].includes(error.status))cloudLoseAccess(error.message);else render();
    }
  };
  cloudState.writeQueue=cloudState.writeQueue.then(task,task);return true;
}
function cloudContextKey(){return JSON.stringify([cloudState.workspaceId,selected,lang,level])}
function cloudProgressReady(){return cloudState.progressKey===cloudContextKey()&&cloudState.progressStatus==='ready'}
function cloudLoadProgress(page=0){
  const key=cloudContextKey(),space=cloudState.workspaceId,lid=selected,language=lang,stage=level,revision=cloudState.progress?.revision;
  const generation=cloudState.progressGeneration=(cloudState.progressGeneration||0)+1;
  cloudState.progressKey=key;cloudState.progressStatus='loading';cloudState.progress=null;cloudState.progressError='';
  data={...data,sessions:[]};durableData=data;
  const task=async()=>{
    try{
      const path='/workspaces/'+encodeURIComponent(space)+'/learners/'+encodeURIComponent(lid)+'/progress?lang='+encodeURIComponent(language)+'&level='+stage;
      let result;
      try{result=await cloudRequest(path+'&page='+page+(page>0?'&revision='+revision:''))}
      catch(error){if(error.code!=='HISTORY_CHANGED')throw error;result=await cloudRequest(path+'&page=0');if(generation===cloudState.progressGeneration)toast('New work is available. Showing the first history page.')}
      if(generation!==cloudState.progressGeneration||key!==cloudContextKey())return false;
      if(!validateBackup({...data,sessions:result.sessions})||result.context.learner!==lid||result.context.lang!==language||result.context.level!==stage)throw Error('These progress records could not be read.');
      data={...data,sessions:result.sessions};durableData=data;cloudState.progress=result;cloudState.progressStatus='ready';cloudState.revision=result.revision;return true;
    }catch(error){
      if(generation!==cloudState.progressGeneration||key!==cloudContextKey())return false;
      cloudState.progressStatus='error';cloudState.progressError=error.message;
      if([401,403].includes(error.status))cloudLoseAccess(error.message);
      return false;
    }finally{if(generation===cloudState.progressGeneration&&key===cloudContextKey())render()}
  };
  cloudState.progressPromise=task();render();return cloudState.progressPromise;
}
function cloudProgressPanel(){
  if(cloudState.progressKey!==cloudContextKey())cloudLoadProgress();
  if(cloudProgressReady())return null;
  return '<section class="card"><h1>'+ (cloudState.progressStatus==='loading'?'Loading progress…':'Progress could not be loaded')+'</h1><p role="status">'+esc(cloudState.progressError||'Opening saved work for '+learner().code+'.')+'</p>'+(cloudState.progressStatus==='error'?'<button class="button primary" data-cloud="refresh-progress">Try again</button>':'')+'</section>';
}
function cloudSummary(){const skills=domainSummary(data,selected,lang,level);if(cloudProgressReady())skills.find(d=>d.id==='fluency').count=cloudState.progress.fluency;return skills}
function cloudHistory(){
  if(!cloudProgressReady())return '';
  const p=cloudState.progress,h=p.history,records=new Map(data.sessions.map(s=>[s.id,s]));
  return recentAll(h.ids.map(id=>records.get(id)))+(p.total?'<nav class="button-row" aria-label="Activity history pages"><button class="button secondary" data-cloud="history" data-page="'+(h.page-1)+'" '+(h.page===0?'disabled':'')+'>Newer</button><span role="status">'+(h.page*20+1)+'–'+Math.min((h.page+1)*20,p.total)+' of '+p.total+'</span><button class="button secondary" data-cloud="history" data-page="'+(h.page+1)+'" '+(!h.hasNext?'disabled':'')+'>Older</button></nav><p class="small">Printing includes this page of activity. Download scores for the complete history.</p>':'');
}
async function cloudExport(kind,lid=null){
  const space=cloudState.workspaceId;toast('Preparing your complete export…');
  try{
    const result=await cloudRequest('/workspaces/'+encodeURIComponent(space)+'/data');
    if(space!==cloudState.workspaceId)throw Error('The learning space changed. Please export again.');
    if(!validateBackup(result.data))throw Error('The export could not be read. Please try again.');
    if(kind==='json')download(JSON.stringify(result.data),'Language-Studio-Backup.json','application/json');
    else download(sessionCSV(result.data,lid),lid?'Learner-Scores-All-Languages-and-Levels.csv':'All-Language-Scores.csv','text/csv;charset=utf-8');
    toast('Your complete export is ready.');
  }catch(error){toast(error.message);if([401,403].includes(error.status))cloudLoseAccess(error.message)}
}
function cloudLoseAccess(message){
  if(window.learningAiReady)aiReset();
  activityGeneration++;cloudState.device?.forgetKey();cloudState.progressGeneration=(cloudState.progressGeneration||0)+1;cloudState.progress=null;cloudState.progressKey=null;clearTimeout(cloudState.draftTimer);cloudState.pendingDraft=null;cloudState.savedDraft=null;speakStop();run=null;readerSession=null;$('readerFrame').srcdoc='';document.querySelectorAll('dialog[open]').forEach(d=>d.close());
  data=emptyData();durableData=data;inMemoryDraft=null;selected='';cloudState.recoveries.clear();recordsUnsaved=false;draftUnsaved=false;updateUnsaved();
  cloudState.status='error';cloudState.error=message;render();
}
function cloudSaveDraft(d){
  const content=JSON.stringify(d);if(content===lastDraftContent&&!draftUnsaved)return;
  inMemoryDraft={...d,revision:draftRevision};draftUnsaved=true;updateUnsaved();
  cloudState.pendingDraft=d;clearTimeout(cloudState.draftTimer);
  cloudState.draftTimer=setTimeout(cloudFlushDraft,350);
}
function cloudFlushDraft(){
  clearTimeout(cloudState.draftTimer);const d=cloudState.pendingDraft;if(!d)return cloudState.draftQueue;
  cloudState.pendingDraft=null;const space=cloudState.workspaceId;pendingWrites++;updateUnsaved();
  const task=async()=>{
    try{
      // Completion deletes the draft in the same transaction as the result.
      if((cloudState.completedIds.has(d.id)||data.sessions.some(s=>s.id===d.id))||cloudState.recoveries.get(d.id)?.stored||cloudState.recoveries.get(d.id)?.localStored)return;
      const saved=cloudState.savedDraft;
      if(saved&&saved.id!==d.id)throw Error('The earlier paused activity could not be cleared. Your new answers remain in this tab.');
      const result=await cloudRequest('/workspaces/'+encodeURIComponent(space)+'/draft','PUT',{revision:saved?.revision||null,draft:d});
      if(cloudState.workspaceId!==space)return;
      if((cloudState.completedIds.has(d.id)||data.sessions.some(s=>s.id===d.id))||cloudState.recoveries.get(d.id)?.stored||cloudState.recoveries.get(d.id)?.localStored)return;
      cloudState.savedDraft={id:d.id,revision:result.draft.revision};
      if(inMemoryDraft?.id===d.id){draftRevision=result.draft.revision;inMemoryDraft.revision=draftRevision;lastDraftContent=JSON.stringify(d)}
      if(!cloudState.pendingDraft&&JSON.stringify({...inMemoryDraft,revision:undefined})===JSON.stringify({...d,revision:undefined}))draftUnsaved=false;
    }catch(error){if(!(cloudState.completedIds.has(d.id)||data.sessions.some(s=>s.id===d.id))&&!cloudState.recoveries.get(d.id)?.stored&&!cloudState.recoveries.get(d.id)?.localStored){draftUnsaved=true;toast(error.message);if([401,403].includes(error.status))cloudLoseAccess(error.message)}}
    finally{pendingWrites--;updateUnsaved();renderResume();if(!run)render()}
  };
  cloudState.draftQueue=cloudState.draftQueue.then(task,task);return cloudState.draftQueue;
}
function cloudClearDraft(id,finished){
  if(cloudState.pendingDraft?.id===id){clearTimeout(cloudState.draftTimer);cloudState.pendingDraft=null}
  if(inMemoryDraft?.id===id){inMemoryDraft=null;draftUnsaved=false;lastDraftContent='';draftRevision=null}
  const space=cloudState.workspaceId;pendingWrites++;updateUnsaved();
  const task=async()=>{
    try{
      if(cloudState.workspaceId!==space)return;
      const saved=cloudState.savedDraft;
      if(saved&&saved.id!==id)return;
      if(finished&&cloudState.recoveries.get(id)?.localStored&&!cloudState.recoveries.get(id)?.stored)return;
      if(!finished)await cloudRequest('/workspaces/'+encodeURIComponent(space)+'/draft','DELETE',{id,revision:saved?.revision||null});
      if(cloudState.savedDraft?.id===id)cloudState.savedDraft=null;
    }catch(error){
      toast(error.message);
      if(!inMemoryDraft&&!run){try{const fresh=await cloudRequest('/workspaces/'+encodeURIComponent(space)+'/bootstrap');if(cloudState.workspaceId===space&&!inMemoryDraft&&!run){inMemoryDraft=fresh.draft;cloudState.savedDraft=fresh.draft?{id:fresh.draft.id,revision:fresh.draft.revision}:null;draftRevision=fresh.draft?.revision||null}}catch{}}
    }
    finally{pendingWrites--;updateUnsaved();renderResume()}
  };
  cloudState.draftQueue=cloudState.draftQueue.then(task,task);
}

function cloudCommitSession(session,done=()=>{}){
  const entry=cloudState.recoveries.get(session.id),s=JSON.parse(JSON.stringify(entry?.session||session));
  if(entry?.saving){done(false,{recoverable:true,recoveryStored:!!entry.stored,record:s,error:'This result is already being saved.'});return false}
  cloudState.recoveries.set(s.id,{...entry,session:s,stored:!!entry?.stored,saving:true,error:''});recordsUnsaved=true;pendingWrites++;updateUnsaved();
  const space=cloudState.workspaceId,device=cloudState.device,path='/workspaces/'+encodeURIComponent(space);
  const retry=async(url,payload)=>{try{return await cloudRequest(url,'PUT',payload)}catch(error){if(error.status)throw error;return cloudRequest(url,'PUT',payload)}};
  const task=async()=>{
    let result;
    try{
      if(device?.enabled()){try{const stored=await device.save(space,s);const entry=cloudState.recoveries.get(s.id);if(entry)entry.localStored=stored}catch(error){const entry=cloudState.recoveries.get(s.id);if(entry)entry.localError=error.message}}
      const staged=await retry(path+'/recovery/'+encodeURIComponent(s.id),{session:s});
      const recovery=cloudState.recoveries.get(s.id);if(recovery&&staged.stored)recovery.stored=true;
      if((staged.stored||staged.completed)&&cloudState.savedDraft?.id===s.id)cloudState.savedDraft=null;
      result=await retry(path+'/sessions/'+encodeURIComponent(s.id),{session:s});
    }catch(error){
      const recovery=cloudState.recoveries.get(s.id);if(recovery){recovery.error=error.message;recovery.saving=false;recovery.code=error.code;recovery.status=error.status}
      recordsUnsaved=cloudState.recoveries.size>0;pendingWrites--;updateUnsaved();toast(error.message);
      const denied=[400,401,403,404,413].includes(error.status),recoverable=!!recovery&&![401,403,404].includes(error.status);
      done(false,{error:error.message,code:error.code,record:s,rejected:denied&&!recoverable,storageFailure:!denied,recoverable,recoveryStored:!!recovery?.stored,deviceStored:!!recovery?.localStored});
      if(error.code==='WORKSPACE_CAPACITY')cloudState.capacity={near:true,full:true};
      if([401,403].includes(error.status))cloudLoseAccess(error.message);else render();return;
    }
    try{await device?.remove(space,s.id)}catch{cloudState.deviceError='The result is saved online, but its device copy could not be removed. Retry device recovery or clear browser copies in Account.'}
    cloudState.completedIds.add(s.id);cloudState.recoveries.delete(s.id);recordsUnsaved=cloudState.recoveries.size>0;
    // A failed refresh must never turn an acknowledged save into a failed save.
    if(space===cloudState.workspaceId){
      if(!result.duplicate)cloudState.total=(cloudState.total||0)+1;
      if(s.learner===selected&&s.lang===lang&&s.level===level)await cloudLoadProgress();
    }
    pendingWrites--;updateUnsaved();done(true,{record:result.session,duplicate:result.duplicate});render();
  };
  cloudState.writeQueue=cloudState.writeQueue.then(task,task);return true;
}
function cloudPrepareDevice(){
  if(cloudState.deviceUser===cloudState.user.id&&cloudState.device)return;
  cloudState.device?.forgetKey();cloudState.deviceUser=cloudState.user.id;cloudState.deviceError='';
  const userId=cloudState.user.id;
  cloudState.device=createDeviceRecovery({storage,crypto:globalThis.crypto,userId,lock:withStorageLock,keyProvider:async()=>{
    const result=await cloudRequest('/me/device-recovery-key','POST',{});
    if(result.userId!==userId){const error=Error('The signed-in account changed. Reopen your workspace.');error.status=401;throw error}
    return result.key;
  }});
}
async function cloudRestoreDevice(){
  const device=cloudState.device,space=cloudState.workspaceId;if(!device||cloudState.status!=='ready')return;
  try{
    if(device.enabled())await device.ready();
    const result=await device.load(space);
    if(device!==cloudState.device||space!==cloudState.workspaceId||cloudState.status!=='ready')return;
    cloudState.deviceError=result.unreadable?'Some device copies could not be read. They have been kept. Retry, or clear device copies in Account only after saving any other work.':'';
    for(const s of result.sessions){
      if(!data.learners.some(l=>l.id===s.learner))continue;
      const current=cloudState.recoveries.get(s.id);
      if(current&&JSON.stringify(current.session)!==JSON.stringify(s)){cloudState.deviceError='A device copy conflicts with another recovery result. Export the visible result before clearing device copies in Account.';continue}
      cloudState.recoveries.set(s.id,{...current,session:s,stored:!!current?.stored,localStored:true});
      if(inMemoryDraft?.id===s.id){inMemoryDraft=null;draftUnsaved=false;lastDraftContent='';draftRevision=null}
    }
    recordsUnsaved=cloudState.recoveries.size>0;updateUnsaved();render();
  }catch(error){
    if(device!==cloudState.device||space!==cloudState.workspaceId)return;
    cloudState.deviceError='Device recovery could not be opened. Your encrypted copies remain in this browser. '+error.message;
    if([401,403].includes(error.status))cloudLoseAccess(error.message);else render();
  }
}
function cloudAutoSync(deviceOnly=false){
  if(cloudState.syncPromise)return cloudState.syncPromise;
  if(cloudState.status!=='ready'||navigator.onLine===false)return Promise.resolve();
  const space=cloudState.workspaceId;
  const task=async()=>{
    if(!deviceOnly)await cloudRestoreDevice();
    for(const [id,r] of [...cloudState.recoveries]){
      if(cloudState.workspaceId!==space||cloudState.status!=='ready'||navigator.onLine===false)break;
      if(r.saving||deviceOnly&&!r.localStored||r.code==='WORKSPACE_CAPACITY'||r.status&&![500,502,503,504].includes(r.status))continue;
      await cloudRetryResult(id);
    }
  };
  cloudState.syncPromise=task().catch(error=>toast(error.message)).finally(()=>{cloudState.syncPromise=null});return cloudState.syncPromise;
}
function cloudDevicePanel(){
  let enabled=false,count=0;
  try{enabled=!!cloudState.device?.enabled();count=cloudState.device?.count()||0}catch{}
  return '<details class="device-recovery"><summary id="deviceRecoverySummary">Device recovery'+(enabled?' · On':' · Off')+'</summary><label class="support-check"><input id="deviceRecoveryEnabled" type="checkbox" '+(enabled?'checked':'')+'><span>Keep unsent completed results on this device</span></label><p class="small">Optional for a trusted device. Copies are encrypted and removed after saving online. Reopening a copy requires an internet connection and this adult account. This does not save unfinished activities or audio, or open the website offline. Clearing browser data removes these copies.</p><p id="deviceRecoveryStatus" role="status">'+count+' device '+(count===1?'copy':'copies')+' across your learning spaces.</p><button id="clearDeviceCopies" class="button subtle danger" data-cloud="clear-device" '+(count?'':'disabled')+'>Clear device copies and turn off</button></details>';
}
function cloudDeviceControls(){
  try{
    if($('deviceRecoverySummary'))$('deviceRecoverySummary').textContent='Device recovery · '+(cloudState.device?.enabled()?'On':'Off');
    if($('clearDeviceCopies'))$('clearDeviceCopies').disabled=!!pendingWrites||!cloudState.device?.count();
  }catch{}
}
function cloudWireDevice(){
  const box=$('deviceRecoveryEnabled');if(!box)return;
  try{box.checked=!!cloudState.device?.enabled()}catch{box.checked=false}
  box.onchange=async()=>{
    const desired=box.checked;box.disabled=true;pendingWrites++;updateUnsaved();
    try{
      await cloudState.device.enable(desired);
      if(desired)for(const [id,r] of cloudState.recoveries)if(!r.saving&&!r.stored){r.localStored=await cloudState.device.save(cloudState.workspaceId,r.session);if(r.localStored)clearDraft(id,true)}
      cloudState.deviceError='';$('deviceRecoveryStatus').textContent=desired?'Device recovery is on for this browser and adult account.':'Device recovery is off.';
    }catch(error){$('deviceRecoveryStatus').textContent=error.message;try{box.checked=cloudState.device.enabled()}catch{box.checked=false}if([401,403].includes(error.status))cloudLoseAccess(error.message)}
    finally{box.disabled=false;pendingWrites--;updateUnsaved();cloudDeviceControls();render()}
  };
}
async function cloudClearDevice(){
  if(run||readerSession||pendingWrites){toast('Finish the current activity and wait for saving before clearing device copies.');return}
  if(!confirm('Clear all encrypted device copies for this adult account and turn device recovery off? Copies that have not reached your account may be lost. Export any results you want to keep first.'))return;
  await cloudState.device.clear();
  for(const r of cloudState.recoveries.values())r.localStored=false;
  cloudState.deviceError='';updateUnsaved();cloudAccount();render();toast('Device copies cleared. Device recovery is off.');
}
function cloudRefreshDeviceFlags(){
  for(const r of cloudState.recoveries.values())if(r.localStored){try{r.localStored=!!cloudState.device?.isStored(cloudState.workspaceId,r.session.id)}catch{r.localStored=false}}
}
function cloudHasTransientWork(){cloudRefreshDeviceFlags();return draftUnsaved||pendingWrites>0||[...cloudState.recoveries.values()].some(r=>!r.stored&&!r.localStored)}
function cloudRenderRecovery(){
  const count=cloudState.recoveries.size;$('cloudRecoveryBanner').hidden=!count&&!cloudState.deviceError;
  $('cloudRecoveryDescription').textContent=cloudState.deviceError||count+' completed '+(count===1?'result needs':'results need')+' attention. '+([...cloudState.recoveries.values()].every(r=>r.stored)?'A recovery copy is saved in your account.':[...cloudState.recoveries.values()].every(r=>r.stored||r.localStored)?'Unsent results have encrypted copies on this device. Reconnect to save online.':'Keep this tab open until you save or export a recovery copy.');
  $('cloudCapacityNotice').hidden=!cloudState.capacity?.near;
  $('cloudCapacityNotice').textContent=cloudState.capacity?.full?'This learning space is full. Completed results may need recovery. Ask an administrator to export records and prepare another space.':'This learning space is almost full. Ask an administrator to prepare space for more records.';
  if($('dataDialog').open)cloudDataControls();if($('accountDialog').open)cloudDeviceControls();
}
function cloudRecoveryList(){
  const entries=[...cloudState.recoveries.values()];$('cloudRecoveryList').hidden=!entries.length;
  $('cloudRecoveryList').innerHTML=entries.length?'<h3>Completed results needing attention</h3><p>These results are kept separate from progress until they are added successfully. Export a recovery copy to restore it into a space with capacity.</p>'+entries.map(r=>'<div class="recovery-result"><strong>'+esc(data.learners.find(l=>l.id===r.session.learner)?.code||'Learner')+' · '+esc(new Date(r.session.at).toLocaleString())+'</strong><p role="status">'+(r.saving?'Saving…':r.stored?'Recovery copy saved in your account.':r.localStored?'Encrypted copy saved on this device. Waiting to save online.':'Only in this tab. Export before closing.')+'</p>'+(r.error?'<p>'+esc(r.error)+'</p>':'')+(r.localError?'<p>Device copy unavailable: '+esc(r.localError)+'</p>':'')+'<div class="button-row"><button class="button primary" data-cloud="retry-result" data-id="'+esc(r.session.id)+'" '+(r.saving?'disabled':'')+'>Retry saving</button><button class="button secondary" data-cloud="export-result" data-id="'+esc(r.session.id)+'">Export recovery copy</button><button class="button subtle danger" data-cloud="discard-result" data-id="'+esc(r.session.id)+'" '+(r.saving?'disabled':'')+'>Discard</button></div></div>').join(''):'';
}
function cloudRetryResult(id){
  const entry=cloudState.recoveries.get(id);if(!entry||entry.saving)return Promise.resolve(false);
  return new Promise(resolve=>cloudCommitSession(entry.session,(saved,detail)=>{if(saved){clearDraft(id,true);toast('Result saved.')}else if(detail.recoveryStored||detail.deviceStored){clearDraft(id,true);toast((detail.recoveryStored?'Your account recovery copy is saved. ':'Your device recovery copy is saved. ')+detail.error)};cloudDataControls();resolve(saved)}));
}
function cloudExportResult(id){
  const entry=cloudState.recoveries.get(id);if(!entry)return;
  const recovery={version:2,learners:data.learners.filter(l=>l.id===entry.session.learner),sessions:[entry.session]};
  download(JSON.stringify(recovery,null,2),'Language-Studio-Recovery-'+id+'.json','application/json');
}
async function cloudDiscardResult(id){
  const entry=cloudState.recoveries.get(id);if(!entry||entry.saving)return;
  if(!confirm('Discard this completed result? If you have not exported a recovery copy, its answers will be lost.'))return;
  const space=cloudState.workspaceId;pendingWrites++;updateUnsaved();
  try{
    // The server may have stored it even when an acknowledgement was lost.
    await cloudRequest('/workspaces/'+encodeURIComponent(space)+'/recovery/'+encodeURIComponent(id),'DELETE',{});
    await cloudState.device?.remove(space,id);
    if(cloudState.workspaceId===space){cloudState.recoveries.delete(id);recordsUnsaved=cloudState.recoveries.size>0;toast('Recovery result discarded.')}
  }finally{pendingWrites--;updateUnsaved();render()}
}
function cloudAccount(){
  if(!cloudState.user)return;
  const disabled=run||readerSession||cloudHasTransientWork()||demo;
  $('accountContent').innerHTML='<p class="account-identity"><strong>'+esc(cloudState.user.name)+'</strong><span>'+esc(cloudState.user.email)+'</span></p>'+
    '<label for="workspacePicker">Learning space</label><select id="workspacePicker" '+(disabled?'disabled':'')+'>'+cloudState.workspaces.map(w=>'<option value="'+esc(w.id)+'" '+(w.id===cloudState.workspaceId?'selected':'')+'>'+esc(w.name)+' · '+esc(cloudRoleName(w.role))+'</option>').join('')+'</select>'+
    (disabled?'<p class="small">Finish or save your activity before switching spaces or signing out.</p>':'')+
    (cloudState.role==='admin'&&cloudState.status==='ready'?'<button class="button primary full" data-cloud="members">Manage users</button>':'')+
    cloudDevicePanel()+
    '<details><summary>Create another learning space</summary>'+cloudWorkspaceForm()+'</details>'+
    (!disabled?'<a class="button secondary full" target="_top" href="'+esc(cloudState.signOut)+'">Sign out</a>':'');
  const select=$('workspacePicker');select.onchange=async()=>{try{await cloudSelectWorkspace(select.value);$('accountDialog').close()}catch(e){cloudState.status='error';cloudState.error=e.message;render();toast(e.message)}};
  cloudWireDevice();$('accountDialog').showModal();
}
function cloudLearnerChecks(ids=[]){return '<fieldset class="assignment-list"><legend>Assigned learners</legend>'+(data.learners.length?data.learners.map(l=>'<label><input type="checkbox" name="assigned" value="'+esc(l.id)+'" '+(ids.includes(l.id)?'checked':'')+'> <span>'+esc(l.code)+'</span></label>').join(''):'<p>Add a learner before inviting a parent.</p>')+'</fieldset>'}
function cloudRoleSelect(role='teacher'){return '<label>Role<select name="role">'+['teacher','parent','admin'].map(r=>'<option value="'+r+'" '+(r===role?'selected':'')+'>'+cloudRoleName(r)+'</option>').join('')+'</select></label>'}
async function cloudMembers(){
  $('accountDialog').close();$('membersContent').innerHTML='<p role="status">Loading users…</p>';
  if(!$('membersDialog').open)$('membersDialog').showModal();
  try{
    const listing=await cloudRequest(cloudPath('/members'));cloudState.memberListing=listing;
    $('membersContent').innerHTML='<p>Administrators manage access and records. Teachers work with all learners. Parents see and practise with only their assigned learners.</p><section class="member-section"><h3>People with access</h3><div class="member-list">'+listing.members.map(m=>'<div class="member-row"><div><strong>'+esc(m.name)+'</strong><span>'+esc(m.email)+'</span><small>'+esc(cloudRoleName(m.role))+' · '+(m.status==='active'?'Active':'Access removed')+(m.id===listing.ownerId?' · Owner':'')+(m.role==='parent'?' · '+m.learnerIds.length+' assigned':'')+'</small></div>'+(m.id!==listing.ownerId?'<button class="button secondary" data-cloud="edit-member" data-id="'+esc(m.id)+'">Edit access</button>':'')+'</div>').join('')+'</div></section>'+
      '<section class="member-section"><h3>Invite someone</h3><form data-cloud-form="invite"><label for="inviteEmail">Their ChatGPT account email</label><input id="inviteEmail" name="email" type="email" required maxlength="320" placeholder="name@example.com">'+cloudRoleSelect()+'<div data-parent-assignments hidden>'+cloudLearnerChecks()+'</div><p class="small">Create a link and share it with this person. It expires after 7 days and works only for their email address.</p><button type="submit" class="button primary">Create invitation link</button><p data-form-error role="alert"></p><div id="inviteResult" hidden></div></form></section>'+
      '<section class="member-section"><h3>Pending invitations</h3><div id="pendingInvitations">'+cloudPendingInvites(listing.invitations)+'</div></section>';
  }catch(error){$('membersContent').innerHTML='<p role="alert">'+esc(error.message)+'</p><button class="button secondary" data-cloud="members">Try again</button>'}
}
function cloudPendingInvites(invites){return invites.length?invites.map(i=>'<div class="member-row"><div><strong>'+esc(i.email)+'</strong><small>'+esc(cloudRoleName(i.role))+' · Expires '+new Date(i.expires_at).toLocaleDateString()+'</small></div><button class="button subtle danger" data-cloud="revoke" data-id="'+esc(i.id)+'">Revoke</button></div>').join(''):'<p class="small">No pending invitations.</p>'}
function cloudEditMember(id){
  const m=cloudState.memberListing.members.find(u=>u.id===id);if(!m)return;
  $('memberEditContent').innerHTML='<p><strong>'+esc(m.name)+'</strong><br>'+esc(m.email)+'</p><form data-cloud-form="member" data-user="'+esc(m.id)+'">'+cloudRoleSelect(m.role)+'<div data-parent-assignments '+(m.role==='parent'?'':'hidden')+'>'+cloudLearnerChecks(m.learnerIds)+'</div><label>Access<select name="status"><option value="active" '+(m.status==='active'?'selected':'')+'>Active</option><option value="inactive" '+(m.status==='inactive'?'selected':'')+'>Remove access</option></select></label><p class="small">Removing access keeps the learner’s completed work.</p><button type="submit" class="button primary">Save access</button><p data-form-error role="alert"></p></form>';
  $('memberEditDialog').showModal();
}
function cloudDataControls(){
  const manager=cloudCanManageLearners();
  $('deleteLearner').disabled=!learner()||cloudState.role!=='admin';$('renameBtn').disabled=!learner()||!manager;
  $('importBtn').hidden=!manager;$('applyPastedBackup').disabled=!manager;
  $('dataStats').textContent=`${data.learners.length} learners · ${cloudState.total||0} completed activities you can access in ${cloudState.workspaceName}.${hasUnsaved?' Some changes are still waiting to save.':''}`;
  let legacy=null;try{legacy=loadData(storage)}catch{}
  $('legacyImport').hidden=!manager||!legacy?.learners.length;
  $('retryCloudSave').hidden=!recordsUnsaved&&!cloudState.deviceError;
  cloudRecoveryList();
}
function cloudSetupUI(){
  $('privacyStorageCopy').textContent='Learner records and paused activities are saved in your private learning space. Administrators and teachers can see all learners there; parents see assigned learners only. Completed results waiting to be added are saved privately to your account for recovery until saved or discarded. Optional Device recovery in Account keeps encrypted copies of unsent completed results in this browser until saved online. Reopening them requires the same adult account and an internet connection. Audio recordings stay in the active tab. Use Saved work to export a backup.';
  $('storageCopy').textContent='Records are saved in your learning space and available on another device when you sign in. Backups include only learners you can access.';
  $('deleteScopeCopy').textContent='Only administrators can delete a learner. Deletion removes their records from this workspace for everyone and cannot be undone. Export a backup first.';
  $('accountBtn').onclick=cloudAccount;
  $('reviewCloudRecovery').onclick=dataDialog;
  window.addEventListener('online',()=>{updateUnsaved();cloudAutoSync()});
  window.addEventListener('offline',()=>{updateUnsaved();toast('You are offline. Completed results will wait to save online.')});
  $('legacyImport').onclick=()=>{
    let local;try{local=loadData(storage)}catch{toast('The old browser records could not be read.');return}
    if(!confirm('Copy '+local.learners.length+' browser learners and '+local.sessions.length+' completed activities into '+cloudState.workspaceName+'? People with access to these learners will be able to see their records.'))return;
    try{importBackupText(JSON.stringify(local),saved=>{if(saved){cloudDataControls();toast('Browser records copied to your workspace. The original browser copy is still available.')}})}catch(e){toast(e.message)}
  };
  $('retryCloudSave').onclick=async()=>{await cloudRestoreDevice();for(const id of [...cloudState.recoveries.keys()])await cloudRetryResult(id)};
  document.addEventListener('change',e=>{if(e.target.name==='role'){const group=e.target.closest('form').querySelector('[data-parent-assignments]');if(group)group.hidden=e.target.value!=='parent'}});
  document.addEventListener('click',async e=>{
    const button=e.target.closest('[data-cloud]');if(!button||button.disabled)return;
    const action=button.dataset.cloud;
    if(action==='members'){cloudMembers();return}if(action==='edit-member'){cloudEditMember(button.dataset.id);return}
    button.disabled=true;
    try{
      if(action==='retry')await cloudInit(cloudState.workspaceId);
      if(action==='clear-device')await cloudClearDevice();
      if(action==='history'){await cloudLoadProgress(Number(button.dataset.page));$('historyHeading')?.focus()}
      if(action==='refresh-progress')await cloudLoadProgress();
      if(action==='retry-result')await cloudRetryResult(button.dataset.id);
      if(action==='export-result')cloudExportResult(button.dataset.id);
      if(action==='discard-result')await cloudDiscardResult(button.dataset.id);
      if(action==='skip-invite'){history.replaceState(null,'',location.pathname+location.hash);await cloudInit()}
      if(action==='accept'){const r=await cloudRequest('/invitations/'+encodeURIComponent(cloudState.inviteToken),'POST',{});history.replaceState(null,'',location.pathname);await cloudInit(r.workspaceId)}
      if(action==='revoke'){await cloudRequest(cloudPath('/invitations/'+encodeURIComponent(button.dataset.id)),'DELETE',{});await cloudMembers()}
      if(action==='copy-invite'){const input=$('invitationLink');try{await navigator.clipboard.writeText(input.value);toast('Invitation link copied.')}catch{input.focus();input.select();toast('Select and copy the invitation link.')}}
    }catch(error){toast(error.message);const output=$('cloudGateError');if(output)output.textContent=error.message}
    finally{button.disabled=false}
  });
  document.addEventListener('submit',async e=>{
    const form=e.target.closest('[data-cloud-form]');if(!form)return;e.preventDefault();
    const submit=form.querySelector('[type="submit"]');if(submit.disabled)return;submit.disabled=true;
    const errorOutput=form.querySelector('[data-form-error]');errorOutput.textContent='';
    try{
      const kind=form.dataset.cloudForm;
      if(kind==='workspace'){
        if(run||readerSession||cloudHasTransientWork())throw Error('Finish or save the current activity first.');
        const r=await cloudRequest('/workspaces','POST',{name:form.elements.workspaceName.value});$('accountDialog').close();await cloudInit(r.workspaceId);
      }else{
        const role=form.elements.role.value,learnerIds=role==='parent'?[...form.querySelectorAll('input[name="assigned"]:checked')].map(i=>i.value):[];
        if(kind==='invite'){
          const r=await cloudRequest(cloudPath('/invitations'),'POST',{email:form.elements.email.value,role,learnerIds});
          const result=$('inviteResult');result.hidden=false;result.innerHTML='<label for="invitationLink">Share this invitation link</label><input id="invitationLink" readonly value="'+esc(r.url)+'"><button type="button" class="button secondary" data-cloud="copy-invite">Copy link</button><p class="small">No email has been sent. Share this latest link yourself; it replaces any earlier unused link for this email. For security, the link is shown only here.</p>';
          const list=await cloudRequest(cloudPath('/members'));$('pendingInvitations').innerHTML=cloudPendingInvites(list.invitations);
        }else if(kind==='member'){
          await cloudRequest(cloudPath('/members/'+encodeURIComponent(form.dataset.user)),'PATCH',{role,status:form.elements.status.value,learnerIds});
          $('memberEditDialog').close();
          if(form.dataset.user===cloudState.user.id){$('membersDialog').close();await cloudInit(cloudState.workspaceId)}else await cloudMembers();
        }
      }
    }catch(error){errorOutput.textContent=error.message}
    finally{submit.disabled=false}
  });
  cloudState.initPromise=cloudInit();
}
if(CLOUD_MODE)cloudSetupUI();
