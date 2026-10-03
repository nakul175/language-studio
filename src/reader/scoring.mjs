export function tokens(text){return text.trim().split(/\s+/u).filter(word=>/[\p{L}\p{N}]/u.test(word))}
export function norm(w){return w.normalize('NFC').toLocaleLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu,'')}
// Set the reading boundary first; word edits stay inside that reviewed prefix.
export function scoreWord(states,index,tool){
  if(!Number.isInteger(index)||index<0||index>=states.length)return [...states];
  if(tool==='end')return states.map((state,i)=>i>index?'unread':state==='unread'?'correct':state);
  if(!['correct','error','skipped'].includes(tool)||index>states.findLastIndex(s=>s!=='unread'))return [...states];
  return states.map((state,i)=>i===index?tool:state);
}
// Prefix alignment: the unread passage tail is not penalised. Internal deletions are skips.
export function align(reference,spoken){const a=tokens(reference),b=tokens(spoken).slice(0,600);if(!b.length)return {states:a.map(()=> 'unread'),extras:[]};const n=a.length,m=b.length;const d=Array.from({length:n+1},()=>new Uint16Array(m+1));for(let i=0;i<=n;i++)d[i][0]=i;for(let j=0;j<=m;j++)d[0][j]=j;for(let i=1;i<=n;i++)for(let j=1;j<=m;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(norm(a[i-1])===norm(b[j-1])?0:1));let end=0;for(let i=1;i<=n;i++)if(d[i][m]<d[end][m]||(d[i][m]===d[end][m]&&Math.abs(i-m)<Math.abs(end-m)))end=i;let i=end,j=m,states=a.map(()=> 'unread'),extras=[];while(i||j){let same=i&&j&&norm(a[i-1])===norm(b[j-1]);if(i&&j&&d[i][j]===d[i-1][j-1]+(same?0:1)){states[i-1]=same?'correct':'error';i--;j--}else if(i&&d[i][j]===d[i-1][j]+1){states[i-1]='skipped';i--}else{extras.unshift(b[j-1]);j--}}return {states,extras}}
export function metrics(states,seconds){let last=states.findLastIndex(s=>s!=='unread');const scored=states.slice(0,last+1);const correct=scored.filter(s=>s==='correct').length,error=scored.filter(s=>s==='error').length,skipped=scored.length-correct-error;return {correct,error,skipped,attempted:scored.length,cwpm:seconds>0?Math.round(correct*60/seconds):0,accuracy:scored.length?Math.round(correct/scored.length*100):0}}
