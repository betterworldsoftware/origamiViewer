import * as THREE from 'three';

// Lines drawn on the paper itself, in material (u, v) space, so they follow
// every bend and are hidden by the layers in front of them:
// - crease marks (thin solid) for creases already made, on both skins;
// - the current step's fold lines (valley dashed, mountain dash-dot-dot) shown
//   before the step plays, each skin seeing its own assignment.
// Segments sit in a float texture: row 0 = (a.u, a.v, b.u, b.v), row 1 =
// (kind, alpha, 0, 0) with kind 0 = mark, 1 = valley seen from the front skin,
// 2 = mountain seen from the front skin.
export const MAX_SEGMENTS=1024;

export function createSegmentTexture(){
  const data=new Float32Array(MAX_SEGMENTS*2*4);
  const texture=new THREE.DataTexture(data,MAX_SEGMENTS,2,THREE.RGBAFormat,THREE.FloatType);
  texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.needsUpdate=true;
  return {texture,set(segments){
    data.fill(0);
    const n=Math.min(MAX_SEGMENTS,segments.length);
    for(let i=0;i<n;i++){const s=segments[i];
      data.set([s.a[0],s.a[1],s.b[0],s.b[1]],4*i);data.set([s.kind,s.alpha??1,0,0],4*(MAX_SEGMENTS+i));}
    texture.needsUpdate=true;return n;
  }};
}

// A MeshStandardMaterial for one skin with the lines mixed into its colour.
// side = +1 front (white) skin, -1 back (coloured) skin.
export function paperSkinMaterial({color,side,segments,uniforms}){
  const material=new THREE.MeshStandardMaterial({color,roughness:.88,side:THREE.FrontSide});
  material.userData.lineColor={value:new THREE.Color()};
  material.userData.inkColor={value:new THREE.Color()};
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,{uSegments:{value:segments},uSegmentCount:uniforms.count,
      uDiagram:uniforms.diagram,uSide:{value:side},uLineColor:material.userData.lineColor,uInk:material.userData.inkColor});
    shader.vertexShader=shader.vertexShader.replace('#include <common>',
      '#include <common>\nattribute vec2 paperUv;\nvarying vec2 vPaperUv;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvPaperUv=paperUv;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
varying vec2 vPaperUv;
uniform sampler2D uSegments;uniform int uSegmentCount;uniform float uDiagram,uSide;
uniform vec3 uLineColor,uInk;
// Dash pattern along a line (material units), its edges smoothed over aa
// (material units per pixel along the line). Phase is the absolute position
// along the line's direction, so the collinear pieces of one fold line (one
// per ply region) keep one rhythm.
float span(float p,float a,float b,float aa){return smoothstep(a-aa,a+aa,p)-smoothstep(b-aa,b+aa,p);}
float dashOn(float s,float kind,float aa){
  aa=min(aa*.5,.004);
  if(kind<1.5){float p=mod(s,.036);return span(p,0.,.022,aa);}           // valley: dash, gap
  float p=mod(s,.06);                                                  // mountain: dash, dot, dot
  return max(span(p,0.,.024,aa),max(span(p,.033,.038,aa),span(p,.046,.051,aa)));
}`).replace('#include <color_fragment>',`#include <color_fragment>
{
  // Widths are measured on screen across each line: material units per pixel
  // in the direction normal to the line, so a line seen at a slant keeps its
  // pixel width and stays sharp instead of smearing wide.
  vec2 dx=dFdx(vPaperUv),dy=dFdy(vPaperUv);
  float mark=0.,ink=0.;
  for(int i=0;i<${MAX_SEGMENTS};i++){
    if(i>=uSegmentCount)break;
    vec4 seg=texelFetch(uSegments,ivec2(i,0),0),info=texelFetch(uSegments,ivec2(i,1),0);
    vec2 a=seg.xy,ab=seg.zw-seg.xy;float len2=dot(ab,ab);if(len2<1e-12)continue;
    vec2 dir=ab/sqrt(len2),nrm=vec2(-dir.y,dir.x);
    float across=max(length(vec2(dot(dx,nrm),dot(dy,nrm))),1e-7),along=length(vec2(dot(dx,dir),dot(dy,dir)));
    float h=clamp(dot(vPaperUv-a,ab)/len2,0.,1.);float d=length(vPaperUv-a-ab*h)/across;  // pixels
    if(info.x<.5){
      // Crease mark: about 0.1 mm on a 15 cm sheet, never under 0.4 px.
      float w=max(.00045/across,.4);float c=(1.-smoothstep(w-.5,w+.5,d))*min(1.,w+.5);
      mark=max(mark,c*info.y);
    }else if(uDiagram>.5){
      float kind=info.x;if(uSide<0.)kind=3.-kind; // the back skin sees the opposite fold
      float c=1.-smoothstep(.6,1.4,d);           // about 2 px wide, 0.8 px soft edge
      ink=max(ink,c*dashOn(dot(vPaperUv,dir),kind,along)*info.y);
    }
  }
  diffuseColor.rgb=mix(diffuseColor.rgb,uLineColor,mark);
  diffuseColor.rgb=mix(diffuseColor.rgb,uInk,ink);
}`);
  };
  return material;
}
