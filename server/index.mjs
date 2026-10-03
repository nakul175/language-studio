import page from '../dist/page.mjs';
import openWorker from '../dist/open-worker.mjs';
import { handleApi } from './api.mjs';

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/open-model-worker.js'&&['GET','HEAD'].includes(request.method))return new Response(request.method==='HEAD'?null:openWorker,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});
    if(url.pathname.startsWith('/api/'))return handleApi(request,env);
    if(!['/','/index.html'].includes(url.pathname)||!['GET','HEAD'].includes(request.method))return new Response('Not found',{status:404});
    return new Response(request.method==='HEAD'?null:page,{headers:{
      'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
      'Permissions-Policy':'microphone=(self), camera=(), geolocation=()',
      'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/ https://cdn.jsdelivr.net/npm/@echogarden/espeak-ng-emscripten@0.3.5/; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; frame-src 'self' about: blob:; connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/ https://cdn.jsdelivr.net/npm/@echogarden/espeak-ng-emscripten@0.3.5/; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'"
    }});
  }
};
