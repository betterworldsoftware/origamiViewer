import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,statSync} from 'node:fs';

// The client must never carry the fold engine: no imports from the server
// package, and none of the engine's functions in the built bundle.
const files=dir=>readdirSync(dir,{recursive:true}).map(f=>`${dir}/${f}`).filter(f=>statSync(f).isFile());
const ENGINE=['buildFoldAnimation','prepareBendSurface','runFoldSequence','prepareTipCone','refinePaper','chooseMotionArrows','bendAcross','solveRigid'];

test('client sources import nothing from the server or the archive',()=>{
  for(const f of files(new URL('../src',import.meta.url).pathname)){
    const text=readFileSync(f,'utf8');
    assert.doesNotMatch(text,/from\s+['"][^'"]*(server|archive|engine)\//,f);
    for(const name of ENGINE)assert.ok(!text.includes(name),`${f} mentions ${name}`);
  }
});

test('the built bundle contains no engine code',()=>{
  const dist=new URL('../dist',import.meta.url).pathname,js=files(dist).filter(f=>f.endsWith('.js'));
  assert.ok(js.length>0,'run vite build first');
  for(const f of js){const text=readFileSync(f,'utf8');for(const name of ENGINE)assert.ok(!text.includes(name),`${f} contains ${name}`);}
});
