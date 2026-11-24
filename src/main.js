import * as THREE from 'three';
import {TrackballControls} from 'three/addons/controls/TrackballControls.js';
import {creaseColor,inkFor,hexToRgb,WHITE_SIDE,WHITE_CREASE} from './diagram/colors.js';
import {createSegmentTexture,paperSkinMaterial} from './diagram/paper-lines.js';
import {createArrowLayer} from './diagram/arrows.js';
import {sideTurn,viewPose,poseBetween,ease} from './camera.js';
import {api} from './api.js';
import {createLoader} from './loader.js';
import {dequantize} from './frames.js';

// Plays the pre-baked crane diagram. The private fold engine is not included.
// Each step opens on its starting state; moving to another step swings the
// camera to that step's view (turn-overs are camera turns, not steps).
const MODEL='crane',TURN_MS=1500;
const canvas=document.querySelector('#gl'),slider=document.querySelector('#frame'),play=document.querySelector('#play');
const colorInput=document.querySelector('#paperColor'),status=document.querySelector('#status'),stepSelect=document.querySelector('#step');
const prev=document.querySelector('#prev'),next=document.querySelector('#next'),percent=document.querySelector('#percent');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0xc9ccce);
renderer.toneMapping=THREE.ACESFilmicToneMapping;
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(35,1,.002,30);camera.up.set(0,0,1);scene.add(camera);
// Lights travel with the camera (key above right, fill below left), so either
// side of the paper is lit alike when the camera turns to face it.
scene.add(new THREE.AmbientLight(0xfff8ee,1.1));
const light=new THREE.DirectionalLight(0xfff1d8,3.2);light.position.set(1.5,2.2,2);camera.add(light);
const fill=new THREE.DirectionalLight(0xc8d7ff,.9);fill.position.set(-2,-1.5,1);camera.add(fill);
const controls=new TrackballControls(camera,canvas);
controls.rotateSpeed=3;controls.zoomSpeed=1.2;controls.panSpeed=.8;controls.dynamicDampingFactor=.15;
const arrowLayer=createArrowLayer(scene);

// Front skin = white side, back skin = coloured side, edge walls a darker
// shade of the paper. Both skins draw crease marks and fold lines.
const segments=createSegmentTexture();
const lineUniforms={count:{value:0},diagram:{value:0}};
const whiteSkin=paperSkinMaterial({color:new THREE.Color().setRGB(...WHITE_SIDE,THREE.SRGBColorSpace),side:1,segments:segments.texture,uniforms:lineUniforms});
const colorSkin=paperSkinMaterial({color:0xffffff,side:-1,segments:segments.texture,uniforms:lineUniforms});
const wall=new THREE.MeshStandardMaterial({roughness:.94,side:THREE.DoubleSide});
whiteSkin.userData.lineColor.value.setRGB(...WHITE_CREASE,THREE.SRGBColorSpace);
whiteSkin.userData.inkColor.value.setRGB(.1,.1,.1,THREE.SRGBColorSpace);
function setPaperColor(hex){
  const rgb=hexToRgb(hex);
  colorSkin.color.setRGB(...rgb,THREE.SRGBColorSpace);
  colorSkin.userData.lineColor.value.setRGB(...creaseColor(rgb),THREE.SRGBColorSpace);
  colorSkin.userData.inkColor.value.setRGB(...inkFor(rgb),THREE.SRGBColorSpace);
  wall.color.setRGB(...rgb.map(c=>c*.6),THREE.SRGBColorSpace);
  try{localStorage.setItem('attempt10-paper',hex);}catch{}
}
let savedColor=null;try{savedColor=localStorage.getItem('attempt10-paper');}catch{}
if(savedColor)colorInput.value=savedColor;
setPaperColor(colorInput.value);
colorInput.oninput=()=>setPaperColor(colorInput.value);

let steps=[],selected=0,index=0,playing=false,last=0,currentView='oblique';
let sheet=null,shownStep=null; // the mesh on screen, and the loaded step it belongs to
const loader=createLoader(MODEL,{keep:2,onUpdate:step=>{if(step.n===selected+1)refresh();}});

// A step's framing: its baked motion box and its arrows.
function framing(step){
  const box=new THREE.Box3(new THREE.Vector3(...step.box.lo),new THREE.Vector3(...step.box.hi)),v=new THREE.Vector3();
  box.expandByScalar(-.02);for(const a of step.arcs)for(const p of a.points)box.expandByPoint(v.set(...p));
  return {center:box.getCenter(new THREE.Vector3()),size:Math.max(.15,box.getSize(v).length()/2)};
}
const poseOf=(step,name=currentView)=>{const {center,size}=framing(step);return viewPose(name,sideTurn(step.turns),center,size);};
const currentPose=()=>({target:controls.target.clone(),position:camera.position.clone(),up:camera.up.clone()});
function setPose(pose){camera.position.copy(pose.position);camera.up.copy(pose.up);controls.target.copy(pose.target);controls.update();}
// The camera swing to a step's view; dragging the model cancels it.
let swing=null;
function swingTo(pose,ms=TURN_MS){swing={from:currentPose(),to:pose,start:performance.now(),ms};}
canvas.addEventListener('pointerdown',()=>{swing=null;});
function view(name){currentView=name;if(steps[selected])swingTo(poseOf(steps[selected]),500);}
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>view(button.dataset.view));

// Displayed frames: a fold plays its baked frames; a crease step plays its
// fold frames forward, then back (the unfold).
const lastFrame=step=>step.frameCount-1;
const bakedFrame=(step,i)=>step.kind==='crease'&&i>=step.bakedFrames?2*step.bakedFrames-1-i:i;
// Fold lines and arrows show on a step's starting state, before it plays.
const diagramShown=()=>index===0&&!playing;
// How far the step's own creases are formed: with the fold for a fold step;
// within the fold half of a crease step (they stay after the unfold).
const markProgress=(step,i)=>Math.min(1,i/(step.kind==='crease'?step.bakedFrames-1:lastFrame(step)));
function updateLines(){
  const step=steps[selected];if(!step)return;
  const list=[];
  for(const s of steps.slice(0,selected))for(const m of s.marks)list.push({...m,kind:0,alpha:1});
  const own=markProgress(step,index);
  if(own>0)for(const m of step.marks)list.push({...m,kind:0,alpha:own});
  if(diagramShown())for(const l of step.lines)list.push({...l,kind:l.assignment==='valley'?1:2,alpha:1});
  lineUniforms.count.value=segments.set(list);lineUniforms.diagram.value=diagramShown()?1:0;
}
function buildMesh(loaded){
  if(sheet){scene.remove(sheet);sheet.geometry.dispose();}
  const m=loaded.manifest,geometry=new THREE.BufferGeometry();
  geometry.setIndex(new THREE.BufferAttribute(loaded.index,1));
  geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(m.vertexCount*3),3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(m.vertexCount*3),3));
  geometry.setAttribute('paperUv',new THREE.BufferAttribute(loaded.uv,2));
  m.groups.forEach(g=>geometry.addGroup(g.start,g.count,g.materialIndex));
  sheet=new THREE.Mesh(geometry,[whiteSkin,colorSkin,wall]);sheet.frustumCulled=false;scene.add(sheet);
  shownStep=loaded;
}
// Show frame i of the selected step if it has arrived; the previous step's
// mesh stays on screen until the new step's first frame is in (its last frame
// is the same surface as this step's first).
function show(i){
  const step=steps[selected],loaded=loader.get(selected+1);
  index=i;slider.value=i;percent.textContent=`${Math.round(i*100/lastFrame(step))}%`;
  const frame=loaded?.frames[bakedFrame(step,i)];
  if(frame){
    if(shownStep!==loaded)buildMesh(loaded);
    const g=sheet.geometry;dequantize(frame,loaded.manifest.box,g.attributes.position.array,g.attributes.normal.array);
    g.attributes.position.needsUpdate=true;g.attributes.normal.needsUpdate=true;
  }
  updateLines();
  return !!frame;
}
const kindName=k=>k==='crease'?'fold and unfold':k==='reverse'?'reverse fold':'fold';
function refresh(){
  const step=steps[selected],loaded=loader.get(selected+1);if(!step)return;
  if(loaded?.error){status.textContent=`Step ${selected+1}: ${loaded.error.message}`;return;}
  const total=step.bakedFrames,have=loaded?.loaded??0,ready=have===total;
  if(shownStep!==loaded&&loaded?.frames[0])show(index);
  slider.disabled=play.disabled=!ready;
  status.textContent=ready
    ?`${step.flex?`DIAGNOSTIC: ${step.flexMethod??'curving-paper solve'} · `:''}${step.draft?'DRAFT bake · ':''}Step ${selected+1} of ${steps.length} · ${step.name} (${kindName(step.kind)}) · ${step.vertexCount.toLocaleString()} vertices · press Play`
    :`Step ${selected+1} · ${step.name}: loading ${have}/${total} frames (${(step.bytes/1e6).toFixed(0)} MB)…`;
}
function setPlaying(on){playing=on;play.textContent=on?'Pause':index===lastFrame(steps[selected])?'Replay':'Play';updateLines();}
function selectStep(i,{instant=false}={}){
  selected=i;stepSelect.value=String(i);playing=false;index=0;
  const step=steps[i];
  slider.max=String(lastFrame(step));
  prev.disabled=i===0;next.disabled=i===steps.length-1;
  // Then the next step, once this one is in.
  loader.load(i+1).done.then(()=>{if(selected===i&&steps[i+1])loader.load(i+2);});
  if(instant)setPose(poseOf(step));else swingTo(poseOf(step));
  show(0);setPlaying(false);refresh();
}
slider.oninput=()=>{playing=false;show(Number(slider.value));setPlaying(false);};
play.onclick=()=>{if(index===lastFrame(steps[selected]))show(0);setPlaying(!playing);};
stepSelect.onchange=()=>selectStep(Number(stepSelect.value));
prev.onclick=()=>selectStep(Math.max(0,selected-1));
next.onclick=()=>selectStep(Math.min(steps.length-1,selected+1));

new ResizeObserver(()=>{
  const w=canvas.clientWidth,h=canvas.clientHeight;
  renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();controls.handleResize();
}).observe(canvas);
renderer.setAnimationLoop(time=>{
  const step=steps[selected];
  // Advance only when the next frame has arrived.
  if(playing&&step&&time-last>1000/30&&loader.get(selected+1)?.frames[bakedFrame(step,index+1)]){
    last=time;show(index+1);if(index===lastFrame(step))setPlaying(false);}
  if(swing){const t=Math.min(1,(time-swing.start)/swing.ms);setPose(poseBetween(swing.from,swing.to,ease(t)));if(t===1)swing=null;}
  controls.update();
  camera.updateMatrixWorld();
  const shown=step&&sheet&&diagramShown();
  arrowLayer.update(camera,canvas.clientWidth,canvas.clientHeight,{crease:step?.kind==='crease',arcs:shown?step.arcs:[],pushes:shown?step.pushes:[]});
  renderer.render(scene,camera);
});

// Inspection hooks for review.
window.attempt10={get state(){return {selected,index,playing,swinging:!!swing,
  steps:steps.map((s,i)=>({id:s.id,name:s.name,kind:s.kind,frameCount:s.frameCount,loaded:loader.get(i+1)?.loaded??0}))};},
  selectStep,show,view,camera,controls,setPaperColor:hex=>{colorInput.value=hex;setPaperColor(hex);}};

(async()=>{
  status.textContent='Connecting…';
  const model=await api(`/api/models/${MODEL}`);
  steps=model.steps;
  if(!steps.length){status.textContent='The crane animation is not available yet.';return;}
  steps.forEach((s,i)=>stepSelect.add(new Option(`${i+1} · ${s.name}`,String(i))));stepSelect.disabled=false;
  const want=Number(new URLSearchParams(location.search).get('step'))||1;
  selectStep(Math.min(Math.max(1,want),steps.length)-1,{instant:true});
})().catch(error=>{status.textContent=error.message;console.error(error);});
