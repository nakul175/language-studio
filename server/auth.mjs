// Sites dispatch authenticates visitors and supplies these trusted headers.
// The Worker does not implement OAuth, passwords, or the reserved auth routes.
export function authenticatedUser(request) {
  const id=request.headers.get('oai-authenticated-user-id');
  const email=request.headers.get('oai-authenticated-user-email');
  if(!id||!email||id.length>300||email.length>320)return null;
  let name=null;
  if(request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8'){
    try{name=decodeURIComponent(request.headers.get('oai-authenticated-user-full-name')||'').trim().slice(0,100)||null}catch{}
  }
  return {id,email:email.trim().toLowerCase(),name:name||email};
}
export function authLinks(returnTo='/') {
  let path='/';
  try{const u=new URL(returnTo,'https://app.local');if(u.origin==='https://app.local'&&!['/signin-with-chatgpt','/signout-with-chatgpt','/callback'].includes(u.pathname))path=u.pathname+u.search+u.hash}catch{}
  return {signIn:'/signin-with-chatgpt?return_to='+encodeURIComponent(path),signOut:'/signout-with-chatgpt?return_to=%2F'};
}
