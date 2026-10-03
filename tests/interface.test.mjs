import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

// Controller regressions with an in-memory DOM adapter. These do not replace
// browser, microphone or responsive visual testing.
function harness(html) {
  const nodes=new Map(), store=new Map();
  function element(id='') {
    const attrs=new Map(), classes=new Set();
    let content='', value='';
    const el={id,style:{},dataset:{},hidden:false,disabled:false,checked:false,open:false,readOnly:false,
      parentElement:{setAttribute(){}},focus(){},select(){},scrollIntoView(){},click(){this.onclick?.()},
      classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)},
      setAttribute(k,v){attrs.set(k,String(v));if(k==='id')this.id=v},getAttribute:k=>attrs.get(k),removeAttribute:k=>attrs.delete(k),
      append(){},replaceChildren(){},showModal(){this.open=true},close(){this.open=false},
      querySelector(){return element()},querySelectorAll(){return []},closest(){return element()},dispatchEvent(){}};
    Object.defineProperty(el,'innerHTML',{get:()=>content,set:v=>{content=v;parse(v)}});
    Object.defineProperty(el,'value',{get:()=>value,set:v=>value=String(v)});
    Object.defineProperty(el,'textContent',{get:()=>content,set:v=>content=String(v)});
    Object.defineProperty(el,'selectedOptions',{get:()=>[{textContent:value==='hi-IN'?'Hindi':value==='en-IN'?'English':'Short sentences'}]});
    return el;
  }
  function parse(markup) {
    for(const m of markup.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
      const tag=m[0], id=m[2], el=nodes.get(id)||element(id);
      if(!nodes.has(id)){el.hidden=/\bhidden\b/.test(tag);el.disabled=/\bdisabled\b/.test(tag);el.checked=/\bchecked\b/.test(tag);el.value=tag.match(/\bvalue="([^"]*)"/)?.[1]||'';nodes.set(id,el)}
    }
  }
  parse(html);
  const document={getElementById:id=>nodes.get(id)||null,querySelectorAll:()=>[],querySelector:()=>null,
    createElement:()=>element(),createTextNode:()=>element(),createDocumentFragment:()=>element(),body:element()};
  const context={document,console,crypto:webcrypto,location:{hash:'',origin:'https://example.test'},navigator:{locks:{request:(_name,task)=>task()}},URL,Blob,Event,
    localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
    setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},confirm:()=>true,
    performance,addEventListener(){},removeEventListener(){},scrollTo(){},print(){}};
  context.window=context;context.parent={postMessage(){}};
  vm.createContext(context);
  return {run:s=>vm.runInContext(s,context),nodes,store,context};
}
const root=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const built=read('dist/index.html'),bundle=built.match(/<script type="module">([\s\S]*)<\/script>/)[1];
const app=harness(read('src/index.html'));
app.run(bundle);
assert.match(app.nodes.get('workspace').innerHTML,/Add your first learner/);
assert.equal(app.nodes.get('learnerBar').hidden,true);
app.nodes.get('learnerCode').value='UX Reader';
app.nodes.get('setupLanguage').value='en-IN';app.nodes.get('setupLevel').value='1';
app.nodes.get('learnerForm').onsubmit({preventDefault(){}});
assert.match(app.nodes.get('workspace').innerHTML,/Start check/);
assert.equal(app.nodes.get('learnerBar').hidden,false);
app.run("startRun('diagnostic','sounds');run.chosen=1;nextTask();");
assert.match(app.nodes.get('activityContent').innerHTML,/Question 2 of 2/);
app.run('closeActivity();');
assert.ok(app.store.has('language-studio-draft-v2'));
app.run('resumeRun();run.chosen=2;nextTask();');
assert.equal(app.run('data.sessions.length'),1);
assert.match(app.nodes.get('activityContent').innerHTML,/Here’s how it went/);
assert.match(app.nodes.get('activityContent').innerHTML,/Start practice/);
assert.ok(!app.store.has('language-studio-draft-v2'));
app.run("closeActivity();startRun('practice','sounds');");
assert.match(app.nodes.get('activityContent').innerHTML,/Try it together/);
app.run('renderTask();run.chosen=2;nextTask();');
assert.match(app.nodes.get('activityContent').innerHTML,/They did this one on their own/);
app.run('nextTask();run.chosen=2;nextTask();nextTask();');
assert.equal(app.run('data.sessions.length'),2);
assert.equal(app.run("summary().find(d=>d.id==='sounds').guided"),1);
assert.match(app.nodes.get('activityContent').innerHTML,/Check again/);
app.run("closeActivity();startRun('diagnostic');");
app.run("while(run){const q=run.items[run.index];if(q.audio)run.heard.add(q.audio);run.chosen=q.kind==='choice'?q.answer:2;nextTask()}");
assert.equal(app.run('data.sessions.length'),3);
assert.equal(app.run('summary().filter(d=>d.ratio!==null).length'),7);
app.run("closeActivity();view='report';render();");
assert.match(app.nodes.get('workspace').innerHTML,/Skills at a glance/);
assert.match(app.nodes.get('workspace').innerHTML,/Compare checks and see teaching notes/);
app.run("showSkill('sounds')");
assert.match(app.nodes.get('activityContent').innerHTML,/See latest answers/);
const saved=app.store.get('language-studio-v2');
const reloaded=harness(read('src/index.html'));reloaded.store.set('language-studio-v2',saved);reloaded.run(bundle);
assert.equal(reloaded.run('data.sessions.length'),3);
assert.equal(reloaded.run('learner().code'),'UX Reader');
app.run("closeActivity();lang='hi-IN';level=2;startRun('diagnostic','comprehension');");
assert.match(app.nodes.get('activityContent').innerHTML,/lang="hi"/);
app.run('closeActivity();render();');
const prefsReload=harness(read('src/index.html'));
for(const [key,value] of app.store)prefsReload.store.set(key,value);
prefsReload.run(bundle);
assert.equal(prefsReload.run('lang'),'hi-IN');assert.equal(prefsReload.run('level'),2);
app.run("download(JSON.stringify(data),'test.json','application/json')");
assert.equal(app.nodes.get('exportDialog').open,true);
assert.equal(JSON.parse(app.nodes.get('exportText').value).sessions.length,3);

const reader=harness(read('src/reader/index.html'));
for(const [id,value] of [['language','en-IN'],['level','1'],['duration','60'],['seconds','60']])reader.nodes.get(id).value=value;
const stripped=s=>s.replace(/^import .*?;\s*$/gm,'').replace(/\bexport\s+(?=(const|function)\b)/g,'');
reader.run(stripped(read('src/reader/scoring.mjs'))+'\n'+stripped(read('src/reader/app.js')));
assert.equal(reader.context.document.body.dataset.step,'read');
reader.nodes.get('manualBtn').onclick();
assert.equal(reader.context.document.body.dataset.step,'review');
reader.nodes.get('finishReview').onclick();
assert.match(reader.nodes.get('notice').textContent,/Mark the words/);
reader.nodes.get('allCorrect').onclick();
reader.nodes.get('seconds').value='30';reader.nodes.get('seconds').oninput();
reader.nodes.get('finishReview').onclick();
assert.equal(reader.context.document.body.dataset.step,'save');
reader.nodes.get('reviewed').checked=true;reader.nodes.get('reviewed').onchange();
assert.equal(reader.nodes.get('saveBtn').disabled,false);
reader.nodes.get('saveBtn').onclick();
assert.equal(reader.run('saved'),true);
assert.equal(JSON.parse(reader.store.get('reading-studio-history')).length,1);
reader.nodes.get('editWords').onclick();
assert.equal(reader.context.document.body.dataset.step,'review');
reader.nodes.get('resetBtn').onclick();
assert.equal(reader.context.document.body.dataset.step,'read');
assert.equal(reader.context.document.body.dataset.unsaved,'false');
console.log('Passed: simplified learner setup, check, pause/resume, practice feedback, results, report, reload, Hindi, export and manual reading controllers.');
