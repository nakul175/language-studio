// Optional structured access to the same selected profile and navigation.
if (document.modelContext?.registerTool) {
  const toolLifecycle = new AbortController();
  const returnToolResult = result => ({ content:[{type:'text',text:JSON.stringify(result)}] });
  const register = tool => {
    try { Promise.resolve(document.modelContext.registerTool(tool,{signal:toolLifecycle.signal})).catch(()=>{}); } catch {}
  };
  register({
    name:'read_selected_learning_profile',
    title:'Read selected learning profile',
    description:'Read the currently selected learner profile, language, level and summary shown in the workspace. Does not modify or export records.',
    inputSchema:{type:'object',properties:{},additionalProperties:false},
    annotations:{readOnlyHint:true,untrustedContentHint:true},
    execute(input){
      if(!input||typeof input!=='object'||Object.keys(input).length)throw Error('This tool accepts an empty object.');
      if(CLOUD_MODE&&learner()&&!cloudProgressReady())return returnToolResult({status:cloudState.progressStatus||'loading',message:'Progress is not available yet.'});
      return returnToolResult(learner()?{learner:learner().code,language:lang,level,sample:demo,skills:summary().map(d=>({skill:d.name,assessed:d.count,independent:d.independent??null,status:d.status}))}:{learner:null});
    }
  });
  register({
    name:'navigate_learning_workspace',
    title:'Open learning workspace view',
    description:'Navigate to overview, diagnostic, practice, reading or report. Does not begin or score a session. Refuses while a dialog is open.',
    inputSchema:{type:'object',properties:{view:{type:'string',enum:['overview','diagnostic','practice','reading','report']}},required:['view'],additionalProperties:false},
    annotations:{readOnlyHint:false,untrustedContentHint:false},
    execute(input){
      if(!input||Object.keys(input).length!==1||!['overview','diagnostic','practice','reading','report'].includes(input.view))throw Error('Invalid view.');
      if(document.querySelector('dialog[open]'))throw Error('Close the active dialog first.');
      location.hash=input.view;view=input.view;render();
      return returnToolResult({view});
    }
  });
  window.addEventListener('pagehide',()=>toolLifecycle.abort(),{once:true});
}
