import * as THREE from 'three';

// Preset views and camera moves. Turning the model over moves the camera,
// not the paper: a step's `turns` (the turn-over axes before it) each turn
// the side being viewed a half turn about that axis, and the preset views
// show that side (as attempt9-page.js).
export const VIEWS={oblique:[1,-1.2,1],top:[0,0,1.6],side:[0,-1.7,.12],under:[.6,-.8,-1.2]};

export function sideTurn(turns=[]){
  const q=new THREE.Quaternion();
  for(const axis of turns)q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(),Math.PI));
  return q;
}

// The camera pose of a preset view of the side `turn` faces, framing a model
// at `center` of radius `size`.
export function viewPose(name,turn,center,size){
  const d=new THREE.Vector3(...VIEWS[name]),len=d.length(),k=1.25*size/Math.tan(35*Math.PI/360)/len;
  return {target:center.clone(),position:d.applyQuaternion(turn).multiplyScalar(k).add(center),
    up:new THREE.Vector3(0,0,1).applyQuaternion(turn)};
}

// Between two camera poses: the camera's orientation slerped, its distance and
// target interpolated, so it swings round the paper from wherever it was.
export function poseBetween(a,b,t){
  const orientation=p=>new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(p.position,p.target,p.up));
  const q=orientation(a).slerp(orientation(b),t),target=a.target.clone().lerp(b.target,t);
  const distance=THREE.MathUtils.lerp(a.position.distanceTo(a.target),b.position.distanceTo(b.target),t);
  return {target,position:new THREE.Vector3(0,0,distance).applyQuaternion(q).add(target),up:new THREE.Vector3(0,1,0).applyQuaternion(q)};
}

export const ease=t=>t*t*(3-2*t);
