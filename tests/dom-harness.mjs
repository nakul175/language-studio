import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
// Minimal DOM for controller integration against the real API and SQLite.
export function harness(html,options={}) {
  const nodes=new Map(), store=options.sharedStore||new Map(), events=new Map(), windowEvents=new Map(), nav=element();
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
  const document={getElementById:id=>nodes.get(id)||null,querySelectorAll:selector=>selector==='dialog[open]'?[...nodes.values()].filter(n=>n.open):[],querySelector:selector=>selector==='.main-nav'?nav:null,addEventListener(type,listener){events.set(type,[...(events.get(type)||[]),listener])},
    createElement:()=>element(),createTextNode:()=>element(),createDocumentFragment:()=>element(),body:element()};
  const context={document,console,crypto:webcrypto,location:{hash:'',origin:'https://example.test'},navigator:{locks:{request:(_name,task)=>task()}},URL,Blob,Event,AbortController,TextEncoder,TextDecoder,btoa,atob,
    localStorage:{get length(){return store.size},key:i=>[...store.keys()][i]??null,getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
    setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},confirm:()=>true,
    ...options,URLSearchParams,history:{replaceState(){}},performance,addEventListener(type,fn){windowEvents.set(type,[...(windowEvents.get(type)||[]),fn])},removeEventListener(){},scrollTo(){},print(){}};
  context.window=context;context.parent={postMessage(){}};
  vm.createContext(context);
  return {run:s=>vm.runInContext(s,context),nodes,store,context,events,windowEvents};
}
