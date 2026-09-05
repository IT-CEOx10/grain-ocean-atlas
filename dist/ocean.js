// Three.js r170 Ocean example: stock Water/Sky lighting and planar reflections.
// The adapter adds a small geometric swell and exposes the exhibition controls.
import * as THREE from './vendor/three.module.js';
import {Water} from './vendor/Water.js';
import {Sky} from './vendor/Sky.js';

export function swell(x,z,t,strength=.6){
 return strength*(.038*Math.sin(x*1.7+z*.6-t*1.2)+.022*Math.sin(x*-.8+z*2.3-t*1.65));
}

export function adaptWaterMaterial(material){
 // glslang 12 reserves 'average'; keep Three's common chunk portable as well.
 material.vertexShader='#define average oceanAverage\n'+material.vertexShader;
 material.fragmentShader='#define average oceanAverage\n'+material.fragmentShader;
 material.uniforms.waveStrength={value:.6};
 material.vertexShader=material.vertexShader.replace('uniform float time;',`uniform float time;
 uniform float waveStrength;`)
 .replace('mirrorCoord = modelMatrix * vec4( position, 1.0 );',`vec3 waterPosition = position;
 vec4 seaWorld = modelMatrix * vec4(position, 1.0);
 waterPosition.z += waveStrength * (
  .038 * sin(seaWorld.x * 1.7 + seaWorld.z * .6 - time * 1.2) +
  .022 * sin(seaWorld.x * -.8 + seaWorld.z * 2.3 - time * 1.65));
 mirrorCoord = modelMatrix * vec4( waterPosition, 1.0 );`)
 .replace('modelViewMatrix * vec4( position, 1.0 )','modelViewMatrix * vec4( waterPosition, 1.0 )');
 // Keep the stock normal-map composition; only expose its intensity to the slider.
 material.fragmentShader=material.fragmentShader.replace('uniform float size;', 'uniform float size;\nuniform float waveStrength;')
 .replace('vec3( 1.5, 1.0, 1.5 )','vec3( .3 + waveStrength, 1.0, .3 + waveStrength )');
 return material;
}

export function createOcean(scene,highQuality){
 const normals=new THREE.Texture();
 const ready=new THREE.TextureLoader().loadAsync('./vendor/waternormals.jpg');
 const sunDirection=new THREE.Vector3(-.35,.48,-.8).normalize();
 const water=new Water(new THREE.PlaneGeometry(190,155,440,360),{
  textureWidth:highQuality?1024:512,textureHeight:highQuality?1024:512,
  waterNormals:normals,sunDirection,sunColor:0xfff0db,
  waterColor:0x064451,distortionScale:.4,fog:false
 });
 water.rotation.x=-Math.PI/2;water.position.set(9,0,-8);
 adaptWaterMaterial(water.material);
 water.material.uniforms.size.value=28;
 scene.add(water);
 const sky=new Sky();sky.scale.setScalar(500);
 const uniforms=sky.material.uniforms;
 uniforms.turbidity.value=6;uniforms.rayleigh.value=2;
 uniforms.mieCoefficient.value=.005;uniforms.mieDirectionalG.value=.8;
 uniforms.sunPosition.value.copy(sunDirection);
 scene.add(sky);
 return {water,ready:ready.then(texture=>{
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.colorSpace=THREE.NoColorSpace;
  texture.anisotropy=4;
  water.material.uniforms.normalSampler.value=texture;
  normals.dispose();
 })};
}
