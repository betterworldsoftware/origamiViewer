import {api} from './api.js';
import {fetchGzip,decodeChunk} from './frames.js';

// Loads baked steps: the manifest (with short-lived Worker links), the mesh,
// then frame chunks in order, so a step shows its first frame as soon as
// chunk 0 is in.
// The few most recently used steps are kept; the rest are dropped to bound
// memory (a full-resolution step is ~170 MB decoded).
export function createLoader(model,{keep=3,onUpdate=()=>{}}={}){
  const steps=new Map();
  function load(n){
    let step=steps.get(n);
    if(step){steps.delete(n);steps.set(n,step);return step;}
    const controller=new AbortController();
    step={n,manifest:null,index:null,uv:null,frames:[],loaded:0,error:null,controller};
    step.done=(async()=>{
      const manifest=await api(`/api/models/${model}/steps/${n}`);
      const [index,uv]=await Promise.all([fetchGzip(manifest.index,controller.signal),fetchGzip(manifest.uv,controller.signal)]);
      step.manifest=manifest;step.index=new Uint32Array(index);step.uv=new Float32Array(uv);
      const take=async c=>{
        const {first,frames}=decodeChunk(await fetchGzip(c.url,controller.signal));
        frames.forEach((f,k)=>{step.frames[first+k]=f;});step.loaded+=frames.length;onUpdate(step);
      };
      await take(manifest.chunks[0]);
      // The rest two at a time (signed links last a few minutes; all start now).
      const rest=manifest.chunks.slice(1);
      await Promise.all([0,1].map(async lane=>{for(let i=lane;i<rest.length;i+=2)await take(rest[i]);}));
    })().catch(error=>{if(error.name!=='AbortError'){step.error=error;onUpdate(step);}});
    steps.set(n,step);
    while(steps.size>keep){const [oldest,s]=steps.entries().next().value;s.controller.abort();steps.delete(oldest);}
    return step;
  }
  return {load,get:n=>steps.get(n)};
}
