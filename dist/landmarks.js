import * as THREE from 'three';

// Architectural miniatures: symbolic country markers, deliberately not to scale.
export const LANDMARKS=[
 {code:'EGY',name:'Пирамиды Гизы',lng:29.4,lat:28.4,build:pyramids},
 {code:'TUR',name:'Галатская башня',lng:33.5,lat:39.3,build:galata},
 {code:'ITA',name:'Колизей',lng:12.7,lat:42.7,build:colosseum},
 {code:'DZA',name:'Памятник мученикам',lng:3.1,lat:31.8,build:memorial},
 {code:'SAU',name:'Крепость Масмак',lng:44.1,lat:24.8,build:fortress}
];
const stone=new THREE.MeshStandardMaterial({color:'#d9bd86',roughness:.83});
const lightStone=new THREE.MeshStandardMaterial({color:'#e7d6b0',roughness:.78});
const trim=new THREE.MeshStandardMaterial({color:'#a28049',roughness:.62,metalness:.15});
const roof=new THREE.MeshStandardMaterial({color:'#355e5b',roughness:.53,metalness:.3});
const dark=new THREE.MeshStandardMaterial({color:'#493d2a',roughness:.95});
function mesh(parent,geometry,material,x=0,y=0,z=0){const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);parent.add(m);return m;}
function box(g,x,y,z,w,h,d,mat=stone){return mesh(g,new THREE.BoxGeometry(w,h,d),mat,x,y,z);}
function cylinder(g,r1,r2,h,y,mat=stone,n=32,x=0,z=0){return mesh(g,new THREE.CylinderGeometry(r1,r2,h,n),mat,x,y,z);}
function archShape(w,h,t){const s=new THREE.Shape();s.moveTo(-w/2,0);s.lineTo(-w/2,h);s.lineTo(w/2,h);s.lineTo(w/2,0);s.closePath();const p=new THREE.Path();const r=(w-2*t)/2,cy=h-t-r;p.moveTo(-r,0);p.lineTo(r,0);p.lineTo(r,cy);p.absarc(0,cy,r,0,Math.PI,false);p.lineTo(-r,0);s.holes.push(p);return s;}
function pyramids(g){
 for(const [x,z,r,h] of [[-.65,.15,.98,1.6],[.65,-.38,.7,1.12],[.75,.8,.4,.65]]){const p=mesh(g,new THREE.ConeGeometry(r,h,4,1),stone,x,h/2,z);p.rotation.y=Math.PI/4;}
 for(let i=0;i<3;i++){const p=mesh(g,new THREE.ConeGeometry(.19,.28,4),lightStone,-1+i*.35,.14,.95);p.rotation.y=Math.PI/4;}
}
function galata(g){
 cylinder(g,.48,.6,.2,.1,trim);cylinder(g,.39,.47,1.5,.95);
 for(const y of [.28,.73,1.17,1.63])cylinder(g,.46,.46,.055,y,lightStone);
 cylinder(g,.62,.47,.16,1.77,lightStone);cylinder(g,.48,.48,.44,2.06);
 cylinder(g,.66,.66,.07,2.31,trim);cylinder(g,0,.65,.86,2.76,roof);
 cylinder(g,.018,.025,.22,3.3,trim,8);
 for(let i=0;i<12;i++){const a=i*Math.PI/6,x=Math.sin(a),z=Math.cos(a);box(g,x*.57,2.01,z*.57,.045,.35,.045,lightStone);for(const y of [.67,1.29]){const window=box(g,x*.425,y,z*.425,.12,.22,.025,dark);window.rotation.y=a;}}
 cylinder(g,.6,.6,.045,2.18,lightStone);
}
function colosseum(g){
 const count=24,rx=1.3,rz=.93;
 // Repeated open arch bays around an elliptical arena; openings are real geometry.
 for(let tier=0;tier<3;tier++)for(let i=0;i<count;i++){
  const a=i/count*Math.PI*2,x=rx*Math.sin(a),z=rz*Math.cos(a);
  const tangent=new THREE.Vector3(rx*Math.cos(a),0,-rz*Math.sin(a)).normalize();
  const width=Math.hypot(rx*Math.cos(a),rz*Math.sin(a))*Math.PI*2/count+.015;
  const geo=new THREE.ExtrudeGeometry(archShape(width,.43,.065),{depth:.18,bevelEnabled:false,curveSegments:8});geo.translate(0,0,-.09);
  const bay=mesh(g,geo,lightStone,x,.1+tier*.45,z);bay.rotation.y=Math.atan2(-tangent.z,tangent.x);
 }
 for(const y of [.08,.54,.99,1.45]){const ring=mesh(g,new THREE.TorusGeometry(1,.065,6,64),stone,0,y,0);ring.rotation.x=Math.PI/2;ring.scale.set(rx,rz,1);}
 const arena=cylinder(g,.82,.82,.035,.055,dark,48);arena.scale.x=1.4;
}
function memorial(g){
 cylinder(g,.9,1,.12,.06,trim);cylinder(g,.66,.76,.14,.18,lightStone);
 // Three tapered curved concrete palms converge around the central spire.
 const shape=new THREE.Shape();shape.moveTo(.78,.25);shape.bezierCurveTo(.75,1.1,.2,1.3,.17,2.3);shape.lineTo(.08,2.88);shape.lineTo(-.06,2.88);shape.bezierCurveTo(-.02,1.5,.38,.66,.49,.25);shape.closePath();
 for(let i=0;i<3;i++){const geo=new THREE.ExtrudeGeometry(shape,{depth:.22,bevelEnabled:true,bevelThickness:.018,bevelSize:.018,bevelSegments:1,steps:1,curveSegments:18});geo.translate(0,0,-.11);const fin=mesh(g,geo,lightStone);fin.rotation.y=i*Math.PI*2/3;}
 cylinder(g,.11,.15,.48,2.82,trim,16);cylinder(g,0,.13,.2,3.16,lightStone,16);
}
function fortress(g){
 box(g,0,.06,0,2.25,.12,1.95,trim);
 box(g,0,.51,-.77,1.8,.9,.2);box(g,-.94,.51,0,.2,.9,1.65);box(g,.94,.51,0,.2,.9,1.65);
 const gate=mesh(g,new THREE.ExtrudeGeometry(archShape(1.85,.9,.3),{depth:.22,bevelEnabled:false,curveSegments:12}),stone,0,.08,.67);
 box(g,0,.28,.82,.55,.4,.06,dark);
 for(const x of [-.92,.92])for(const z of [-.77,.77]){
  cylinder(g,.28,.34,1.13,.64,stone,20,x,z);cylinder(g,.31,.31,.09,1.22,lightStone,20,x,z);
  for(let i=0;i<8;i++){const a=i*Math.PI/4;box(g,x+Math.cos(a)*.255,1.34,z+Math.sin(a)*.255,.11,.17,.11,lightStone);}
 }
 for(let i=-3;i<=3;i++)for(const z of [-.77,.77])box(g,i*.23,1.06,z,.12,.18,.2,lightStone);
 for(let i=-2;i<=2;i++)for(const x of [-.94,.94])box(g,x,1.06,i*.25,.2,.18,.12,lightStone);
}
// Bake the static architectural pieces by material to keep draw calls low.
function batchModel(model){
 model.updateMatrixWorld(true);const batches=new Map();
 model.traverse(o=>{if(!o.isMesh)return;const geometry=(o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone());geometry.applyMatrix4(o.matrixWorld);let batch=batches.get(o.material);if(!batch){batch={position:[],normal:[]};batches.set(o.material,batch);}for(const key of ['position','normal'])for(const value of geometry.attributes[key].array)batch[key].push(value);geometry.dispose();o.geometry.dispose();});
 model.clear();for(const [material,batch] of batches){const geo=new THREE.BufferGeometry();for(const key of ['position','normal'])geo.setAttribute(key,new THREE.Float32BufferAttribute(batch[key],3));geo.computeBoundingSphere();mesh(model,geo,material);}
}
export function createLandmarks(scene,point){
 const group=new THREE.Group();group.name='country-landmarks';scene.add(group);
 const items=LANDMARKS.map(spec=>{
  const root=new THREE.Group();root.name=spec.name;root.position.copy(point(spec.lng,spec.lat,.28));group.add(root);
  const model=new THREE.Group();spec.build(model);batchModel(model);root.add(model);
  cylinder(root,1.42,1.5,.11,-.005,new THREE.MeshStandardMaterial({color:'#263f36',roughness:.9}),48);
  const ring=mesh(root,new THREE.TorusGeometry(1.47,.025,6,64),new THREE.MeshBasicMaterial({color:'#b99d65',transparent:true,opacity:.4}),0,.065,0);ring.rotation.x=Math.PI/2;
  root.traverse(o=>{if(o.isMesh)o.userData.code=spec.code;});
  return {...spec,root,model,ring};
 });
 return {group,items,select(code){for(const item of items){const active=item.code===code;item.ring.material.opacity=active?1:.4;item.ring.material.color.set(active?'#ffe3a1':'#b99d65');item.model.scale.setScalar(active?1.12:1);}}};
}
