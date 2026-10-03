import {validSession} from './engine.mjs';

// Optional, temporary transport copies. D1 remains the authority for progress.
// The decryption key is fetched after sign-in and is never written to the device.
export function createDeviceRecovery({storage,crypto,userId,keyProvider,lock}){
  const prefix='language-studio-outbox-v1:'+encodeURIComponent(userId)+':',preference=prefix+'enabled';
  const encoder=new TextEncoder(),decoder=new TextDecoder(),observed=new Map();let keyPromise;
  const keyFor=(space,id)=>prefix+'result:'+encodeURIComponent(space)+':'+encodeURIComponent(id);
  const resultPrefix=space=>prefix+'result:'+(space===undefined?'':encodeURIComponent(space)+':');
  const keys=space=>{const found=[];for(let i=0;i<storage.length;i++){const k=storage.key(i);if(k?.startsWith(resultPrefix(space)))found.push(k)}return found};
  const enabled=()=>storage.getItem(preference)==='1';
  const locked=task=>new Promise((resolve,reject)=>{try{lock(()=>{try{resolve(task())}catch(e){reject(e)}},reject)}catch(e){reject(e)}});
  const ready=()=>{
    if(!crypto?.subtle) return Promise.reject(Error('Encrypted device recovery is unavailable in this browser.'));
    if(!keyPromise)keyPromise=Promise.resolve().then(keyProvider).then(value=>{
      if(!/^[a-f0-9]{64}$/.test(value))throw Error('Your device recovery key could not be loaded.');
      return crypto.subtle.importKey('raw',Uint8Array.from(value.match(/../g),x=>parseInt(x,16)),{name:'AES-GCM'},false,['encrypt','decrypt']);
    }).catch(e=>{keyPromise=null;throw e});
    return keyPromise;
  };
  const bytesToText=bytes=>{let raw='';for(const n of bytes)raw+=String.fromCharCode(n);return btoa(raw)};
  const textToBytes=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
  async function decode(key,raw){
    if(!raw||raw.length>500000)throw Error('Unreadable device copy.');
    const entry=JSON.parse(raw);if(entry.version!==1||typeof entry.iv!=='string'||typeof entry.ciphertext!=='string')throw Error('Unreadable device copy.');
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:textToBytes(entry.iv),additionalData:encoder.encode(key)},await ready(),textToBytes(entry.ciphertext));
    const session=JSON.parse(decoder.decode(plain));if(!validSession(session)||!key.endsWith(':'+encodeURIComponent(session.id)))throw Error('Invalid device result.');return session;
  }
  return {
    enabled,ready,count:space=>keys(space).length,
    isStored(space,id){const key=keyFor(space,id),value=observed.get(key);return !!value&&storage.getItem(key)===value},
    async enable(value){
      if(value)await ready();
      await locked(()=>{if(!value&&keys().length)throw Error('Save or clear your device copies before turning this off.');storage.setItem(preference,value?'1':'0');if(enabled()!==value)throw Error('This browser could not save the device recovery setting.')});
    },
    async save(space,session){
      if(!enabled())return false;
      if(typeof space!=='string'||!space||space.length>120||!validSession(session))throw Error('This result cannot be saved for device recovery.');
      const plain=encoder.encode(JSON.stringify(session));if(plain.length>300000)throw Error('This result is too large for a device copy.');
      const key=keyFor(space,session.id),iv=crypto.getRandomValues(new Uint8Array(12));
      const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(key)},await ready(),plain);
      const value=JSON.stringify({version:1,iv:bytesToText(iv),ciphertext:bytesToText(new Uint8Array(ciphertext))});
      for(let attempt=0;attempt<3;attempt++){
        const previous=storage.getItem(key);
        if(previous&&JSON.stringify(await decode(key,previous))!==JSON.stringify(session))throw Error('A different device copy already uses this activity ID.');
        const result=await locked(()=>{
          if(!enabled())return false;
          if(storage.getItem(key)!==previous)return null;
          if(previous){observed.set(key,previous);return true}
          const all=keys();if(all.length>=20||keys(space).length>=10)throw Error('Device recovery is full. Save or export existing copies first.');
          if(all.reduce((n,k)=>n+(storage.getItem(k)?.length||0)*2,0)+value.length*2>2*1024*1024)throw Error('Device recovery is full. Save or export existing copies first.');
          storage.setItem(key,value);if(storage.getItem(key)!==value)throw Error('The device copy could not be confirmed.');observed.set(key,value);return true;
        });
        if(result!==null)return result;
      }
      throw Error('Another tab changed device recovery. Keep this tab open and retry.');
    },
    async load(space){
      const list=keys(space);if(!list.length)return {sessions:[],unreadable:0};await ready();
      const sessions=[];let unreadable=0;
      for(const key of list){try{const raw=storage.getItem(key),s=await decode(key,raw);if(storage.getItem(key)!==raw)throw Error('Device copy changed.');observed.set(key,raw);sessions.push(s)}catch{unreadable++}}
      return {sessions,unreadable};
    },
    remove:(space,id)=>locked(()=>{const key=keyFor(space,id);storage.removeItem(key);observed.delete(key)}),
    clear:()=>locked(()=>{storage.setItem(preference,'0');for(const key of keys())storage.removeItem(key);observed.clear()}),
    forgetKey(){keyPromise=null}
  };
}
