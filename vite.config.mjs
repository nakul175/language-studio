import worker from './dist/server/index.js';
import {localDatabase} from './server/local-db.mjs';
// No simulated preview sign-in. Only production Sites dispatch owns identity.
const DB=localDatabase();
export default {root:'dist',server:{host:'0.0.0.0',allowedHosts:['terminal.local']},plugins:[{name:'language-studio-worker-preview',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(!req.url?.startsWith('/api/')&&!['/','/index.html'].includes(req.url?.split('?')[0]))return next();
  try{
    const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>11*1024*1024){res.statusCode=413;res.end('Too large');return}parts.push(part)}
    const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(!key.startsWith('oai-')&&value)headers.set(key,Array.isArray(value)?value.join(','):value);
    const request=new Request('http://'+req.headers.host+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(parts)}:{})});
    const response=await worker.fetch(request,{DB});res.statusCode=response.status;response.headers.forEach((v,k)=>res.setHeader(k,v));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.statusCode=500;res.end('Preview unavailable')}
})}}]};
