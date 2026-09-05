import * as THREE from './vendor/three.module.js';
import {ROUTES} from './routes.js';
import {swell} from './ocean.js';

// Follow the shipping polylines exactly, including the narrow straits.
export function shippingLane(coordinates){
 const points=coordinates.map(([lng,lat])=>new THREE.Vector3((lng-22)*.86,0,-(lat-37)));
 const distances=[0];
 for(let i=1;i<points.length;i++)distances.push(distances[i-1]+points[i].distanceTo(points[i-1]));
 return {points,distances,length:distances.at(-1)};
}

export function lanePosition(lane,distance){
 const d=THREE.MathUtils.clamp(distance,0,lane.length);
 let low=1,high=lane.points.length-1;
 while(low<high){const mid=(low+high)>>1;if(lane.distances[mid]<d)low=mid+1;else high=mid;}
 const a=lane.points[low-1],b=lane.points[low];
 const fraction=(d-lane.distances[low-1])/(lane.distances[low]-lane.distances[low-1]);
 return {position:a.clone().lerp(b,fraction),direction:b.clone().sub(a).normalize()};
}

export function createFleet(scene,template){
 const lanes=ROUTES.map(route=>shippingLane(route.points));
 const vessels=Array.from({length:8},(_,i)=>{
  // Share geometry and materials with the existing carrier.
  const mesh=template.clone(true);mesh.scale.setScalar(.62+(i%3)*.08);scene.add(mesh);
  const lane=lanes[i%lanes.length];
  return {mesh,lane,speed:.12+(i%4)*.022,offset:lane.length*(.12+i*.217)};
 });
 return {vessels,update(time,strength){
  for(const [i,vessel] of vessels.entries()){
   const phase=(vessel.offset+time*vessel.speed)%(2*vessel.lane.length);
   const outbound=phase<vessel.lane.length;
   const distance=outbound?phase:2*vessel.lane.length-phase;
   const {position,direction}=lanePosition(vessel.lane,distance);
   if(!outbound)direction.negate();
   vessel.mesh.position.copy(position);
   vessel.mesh.position.y=swell(position.x,position.z,time,strength)-.025;
   vessel.mesh.rotation.set(Math.sin(time*.95+i)*.012,Math.atan2(-direction.x,-direction.z),Math.sin(time*1.6+i)*.018);
  }
 }};
}
