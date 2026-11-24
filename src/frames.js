// Baked step files: gzip downloads, and the frame chunk decoder (the format
// is written by server/bake/encode.js; keep the two in step).
const MAGIC=0x3152464f;

export async function fetchGzip(url,signal){
  const r=await fetch(url,{signal});
  if(!r.ok)throw new Error(`Download failed (HTTP ${r.status})`);
  return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

// Raw chunk → {first, frames: [{q: Int16Array positions, n: Int8Array normals}]}.
export function decodeChunk(buffer){
  const bytes=new Uint8Array(buffer),[magic,count,frames,first]=new Uint32Array(buffer,0,4);
  if(magic!==MAGIC)throw new Error('Not a frame chunk');
  const values=count*3,result=[];let off=16;
  for(let k=0;k<frames;k++){
    const q=new Int16Array(values),n=new Int8Array(values),p=result[k-1];
    for(let i=0;i<values;i++){const d=(bytes[off+i]|bytes[off+values+i]<<8)<<16>>16;q[i]=p?p.q[i]+d:d;}
    off+=2*values;
    const dn=new Int8Array(buffer,off,values);
    for(let i=0;i<values;i++)n[i]=p?p.n[i]+dn[i]:dn[i];
    off+=values;result.push({q,n});
  }
  return {first,frames:result};
}

// Positions and normals of one decoded frame into the geometry's arrays.
export function dequantize(frame,{lo,hi},positions,normals){
  const {q,n}=frame,s=[0,1,2].map(c=>(hi[c]-lo[c])/65535);
  for(let i=0;i<q.length;i+=3){
    positions[i]=lo[0]+(q[i]+32768)*s[0];positions[i+1]=lo[1]+(q[i+1]+32768)*s[1];positions[i+2]=lo[2]+(q[i+2]+32768)*s[2];
  }
  for(let i=0;i<n.length;i++)normals[i]=n[i]/127;
}
