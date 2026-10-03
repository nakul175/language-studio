// Serialize the short synchronous localStorage transaction across tabs.
// IndexedDB's read/write transaction is the fallback for browsers without
// Web Locks; it holds the same exclusive object-store scope in every tab.
export function withStorageLock(task,onFailure) {
  if(navigator.locks?.request){
    try{const result=navigator.locks.request('language-studio-write',task);result?.catch?.(onFailure);return result}catch(error){onFailure(error);return false}
  }
  if(!window.indexedDB){onFailure(Error('Safe browser saving is unavailable. Keep this tab open and export your work.'));return false}
  const request=window.indexedDB.open('language-studio-save-lock',1);
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('writer'))request.result.createObjectStore('writer')};
  request.onerror=()=>onFailure(Error('Browser storage is unavailable.'));
  request.onblocked=()=>onFailure(Error('Another tab is blocking browser storage. Close it and retry.'));
  request.onsuccess=()=>{
    const db=request.result;
    try{
      const transaction=db.transaction('writer','readwrite');
      transaction.oncomplete=()=>db.close();
      transaction.onabort=()=>{db.close();onFailure(Error('Browser save was interrupted.'))};
      transaction.objectStore('writer').get('lock').onsuccess=()=>{try{task()}catch(error){onFailure(error)}};
    }catch(error){db.close();onFailure(error)}
  };
}
