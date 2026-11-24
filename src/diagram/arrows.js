import * as THREE from 'three';

// Diagram arrows as 3D geometry, rebuilt every frame. Each arrow's path is a
// 3D arc (diagram.js); every frame it is projected, and its stroke and heads
// are laid out in screen pixels at a constant width, then each vertex is put
// back in 3D at the depth of the arc point it belongs to. So the arrow keeps
// one pixel weight from any angle (seen edge-on the arc is still a line of the
// same weight: a billboard), yet it is depth-tested: paper in front of an
// arrow hides it.
//
// Heads (Yoshizawa–Randlett / Lang):
// - valley (the flap swings toward its outside): filled, symmetric, cleft;
// - mountain (it swings the other way): hollow, one-sided.
// Which one, and the side the arc is on, are fixed per arrow from the flap's
// outside (diagram.js outwardArc), not from the camera.
// - fold and unfold: also a hollow double-sided head at the tail;
// - push (reverse folds): a hollow arrow with a broad body and cleft tail.
const INK=0x1b1b1b,PAPER_WHITE=0xffffff;
// Layers, drawn in this order: white halo, ink strokes and filled heads,
// hollow-head fills, hollow-head outlines.
const LAYERS=[{color:PAPER_WHITE,order:10},{color:INK,order:11},{color:PAPER_WHITE,order:12},{color:INK,order:13}];
const HALO=0,INKED=1,FILL=2,OUTLINE=3;

const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]],len=a=>Math.hypot(a[0],a[1]);
const norm=a=>{const n=len(a);return n>1e-9?[a[0]/n,a[1]/n]:[1,0];};

export function createArrowLayer(scene){
  const meshes=LAYERS.map(({color,order})=>{
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(0),3));
    const material=new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,depthTest:true,depthWrite:false,
      toneMapped:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-8});
    const mesh=new THREE.Mesh(geometry,material);mesh.renderOrder=order;mesh.frustumCulled=false;mesh.visible=false;scene.add(mesh);
    return mesh;
  });
  const v=new THREE.Vector3();
  let tris,camera,width,height;
  // A 3D point → [px, py, ndc depth], nudged toward the camera by 1% of its
  // distance so an arrow touching the paper (tail on the moving point) stays
  // in front of that paper.
  const project=p=>{
    const e=camera.position;
    v.set(p[0]+(e.x-p[0])*.01,p[1]+(e.y-p[1])*.01,p[2]+(e.z-p[2])*.01).project(camera);
    return v.z>1||v.z<-1?null:[(v.x+1)/2*width,(1-v.y)/2*height,v.z];
  };
  const push=(layer,...pts)=>{for(const p of pts)tris[layer].push(p[0],p[1],p[2]);};
  const at=(p,z)=>[p[0],p[1],z];

  // A stroke of `w` px along a projected polyline (each point [x, y, z]).
  function stroke(layer,pts,w,closed=false){
    const n=pts.length;if(n<2)return;
    const seg=i=>norm(sub(pts[(i+1)%n],pts[i]));
    const offsets=pts.map((p,i)=>{
      const a=i>0||closed?seg((i-1+n)%n):null,b=i<n-1||closed?seg(i):null;
      const na=a&&[-a[1],a[0]],nb=b&&[-b[1],b[0]];
      if(!na)return nb;if(!nb)return na;
      const m=norm([na[0]+nb[0],na[1]+nb[1]]),k=Math.max(.5,m[0]*nb[0]+m[1]*nb[1]);
      return [m[0]/k,m[1]/k];
    });
    const side=(i,s)=>[pts[i][0]+offsets[i][0]*w/2*s,pts[i][1]+offsets[i][1]*w/2*s,pts[i][2]];
    for(let i=0;i<(closed?n:n-1);i++){const j=(i+1)%n;
      push(layer,side(i,1),side(i,-1),side(j,1),side(j,1),side(i,-1),side(j,-1));}
  }
  // A fan from the first point (heads are fans from their tip).
  function fan(layer,pts){for(let i=1;i<pts.length-1;i++)push(layer,pts[0],pts[i],pts[i+1]);}
  function filled(poly,z){const p=poly.map(q=>at(q,z));stroke(HALO,p,4,true);fan(INKED,p);stroke(INKED,p,1.2,true);}
  function hollow(poly,z,triangles=null){const p=poly.map(q=>at(q,z));stroke(HALO,p,4,true);
    if(triangles)for(const [a,b,c] of triangles)push(FILL,p[a],p[b],p[c]);else fan(FILL,p);
    stroke(OUTLINE,p,1.4,true);}

  function cleftHead(tip,d,size){
    const n=[-d[1],d[0]],back=[tip[0]-d[0]*size,tip[1]-d[1]*size],notch=[tip[0]-d[0]*size*.62,tip[1]-d[1]*size*.62],w=size*.45;
    return [tip,[back[0]+n[0]*w,back[1]+n[1]*w],notch,[back[0]-n[0]*w,back[1]-n[1]*w]];
  }
  function halfHead(tip,d,size,s){
    const n=[-d[1]*s,d[0]*s],back=[tip[0]-d[0]*size,tip[1]-d[1]*size],stem=[tip[0]-d[0]*size*.7,tip[1]-d[1]*size*.7],w=size*.5;
    return [tip,[back[0]+n[0]*w,back[1]+n[1]*w],stem];
  }
  // Direction arriving at the end, over the last `back` px.
  function endDirection(pts,back){
    const end=pts.at(-1);
    for(let i=pts.length-2;i>=0;i--)if(len(sub(end,pts[i]))>=back)return norm(sub(end,pts[i]));
    return norm(sub(end,pts[0]));
  }
  // The polyline with `distance` px removed from its end.
  function trimEnd(pts,distance){
    const out=[...pts];let left=distance;
    while(out.length>1){const a=out.at(-2),b=out.at(-1),l=len(sub(b,a));
      if(l>left){const t=(l-left)/l;out[out.length-1]=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];break;}
      left-=l;out.pop();}
    return out;
  }

  // arcs/pushes are in world space (already moved with the model).
  function update(cam,w,h,{arcs=[],pushes=[],crease=false,scale=1}={}){
    camera=cam;width=w;height=h;tris=LAYERS.map(()=>[]);
    const size=15*scale,line=2.2*scale;
    for(const {points,valley} of arcs){
      const pts=points.map(project);if(pts.some(p=>!p))continue;
      if(len(sub(pts.at(-1),pts[0]))<size*1.5)continue;
      const tip=pts.at(-1),d=endDirection(pts,size*1.2);
      let stem=trimEnd(pts,size*(valley?.55:.3));
      let tail=null;
      if(crease){tail=cleftHead(pts[0],endDirection([...pts].reverse(),size*1.2),size);
        stem=trimEnd([...stem].reverse(),size*.55).reverse();}
      stroke(HALO,stem,line+3);stroke(INKED,stem,line);
      if(valley)filled(cleftHead(tip,d,size),tip[2]);
      else{
        // The barb goes on the outside of the curve.
        const c=pts[Math.floor(pts.length/2)],mid=[(pts[0][0]+tip[0])/2,(pts[0][1]+tip[1])/2];
        const out=norm(sub(c,mid)),s=Math.sign(-d[1]*out[0]+d[0]*out[1])||1;
        hollow(halfHead(tip,d,size,s),tip[2]);
      }
      if(tail)hollow(tail,pts[0][2]);
    }
    for(const p of pushes){
      const a=project(p.from),b=project(p.to);if(!a||!b)continue;
      const total=len(sub(b,a));if(total<size*1.6)continue;
      const d=norm(sub(b,a)),n=[-d[1],d[0]],body=size*.28,head=size*.75,hl=size*1.1,notch=size*.4;
      const q=(t,s)=>[a[0]+d[0]*t+n[0]*s,a[1]+d[1]*t+n[1]*s];
      // b, head barbs, body corners, tail corners and the tail's cleft.
      const poly=[b,q(total-hl,head),q(total-hl,body),q(0,body),q(notch,0),q(0,-body),q(total-hl,-body),q(total-hl,-head)];
      hollow(poly,b[2],[[0,1,7],[2,3,4],[2,4,6],[6,4,5]]);
    }
    meshes.forEach((mesh,k)=>{
      const t=tris[k],positions=new Float32Array(t.length);
      for(let i=0;i<t.length;i+=3){
        v.set(t[i]/width*2-1,1-t[i+1]/height*2,t[i+2]).unproject(camera);
        positions[i]=v.x;positions[i+1]=v.y;positions[i+2]=v.z;
      }
      mesh.geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
      mesh.visible=t.length>0;
    });
  }
  return {update};
}

// The "turn over" symbol (a looped arrow), drawn on a 2D overlay beside the
// model: it is a symbol for the whole model, not a path over the paper.
export function drawTurnOver(ctx,x,y,s=1){
  ctx.save();ctx.translate(x,y);ctx.scale(s,s);
  const path=()=>{ctx.beginPath();ctx.moveTo(-46,6);ctx.bezierCurveTo(-20,6,-4,4,4,-8);
    ctx.bezierCurveTo(12,-22,-12,-26,-10,-10);ctx.bezierCurveTo(-8,6,18,8,40,6);};
  ctx.lineCap='round';ctx.lineJoin='round';
  path();ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=5.5;ctx.stroke();
  path();ctx.strokeStyle='#1b1b1b';ctx.lineWidth=2.4;ctx.stroke();
  ctx.beginPath();ctx.moveTo(52,6);ctx.lineTo(38,-1);ctx.lineTo(42,6);ctx.lineTo(38,13);ctx.closePath();
  ctx.fillStyle='#1b1b1b';ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=3;ctx.stroke();ctx.fill();
  ctx.restore();
}
