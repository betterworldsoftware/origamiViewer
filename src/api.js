// The server API: a session token for this origin (renewed before it
// expires, and once more on a 401), then JSON calls with it.
export const API_URL=(import.meta.env.VITE_API_URL??'http://127.0.0.1:8787').replace(/\/$/,'');
let session=null;

async function token(){
  if(session&&session.expiresAt*1000>Date.now()+30e3)return session.token;
  const r=await fetch(`${API_URL}/api/session`,{method:'POST'});
  if(!r.ok)throw new Error(`Could not start a session (HTTP ${r.status})`);
  session=await r.json();return session.token;
}

export async function api(path){
  for(let attempt=0;;attempt++){
    const r=await fetch(API_URL+path,{headers:{Authorization:`Bearer ${await token()}`}});
    if(r.status===401&&attempt===0){session=null;continue;}
    if(!r.ok)throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  }
}
