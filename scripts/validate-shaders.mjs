// Run with a real GLSL validator, e.g. node scripts/validate-shaders.mjs /path/to/glslangValidator.
// Uses the shipped shader sources and Three.js chunks, targeting the same GLSL ES 3.00 dialect.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ShaderChunk,PlaneGeometry} from '../dist/vendor/three.module.js';
import {Water} from '../dist/vendor/Water.js';
import {Sky} from '../dist/vendor/Sky.js';
import {adaptWaterMaterial} from '../dist/ocean.js';
import {landVertex,landFragment} from '../dist/shaders.js';

const water=adaptWaterMaterial(new Water(new PlaneGeometry(10,10)).material);
const sky=new Sky().material;
const validator=process.argv[2]||'glslangValidator';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'grain-glsl-'));
const resolve=source=>source.replace(/#include\s+<([^>]+)>/g,(_,name)=>resolve(ShaderChunk[name]));
const prepare=source=>resolve(source).replace(/NUM_[A-Z_]+/g,name=>['NUM_DIR_LIGHTS','NUM_HEMI_LIGHTS'].includes(name)?'1':'0');
const version='#version 300 es\nprecision highp float;\nprecision highp int;\n';
const vertexPrefix=version+`#define varying out
in vec3 position;
in vec3 normal;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
`;
const fragmentPrefix=version+`#define texture2D texture
#define varying in
layout(location=0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
uniform vec3 cameraPosition;
uniform mat4 viewMatrix;
uniform bool isOrthographic;
#define TONE_MAPPING
`+ShaderChunk.tonemapping_pars_fragment+`
vec3 toneMapping(vec3 color){return ACESFilmicToneMapping(color);}
`+ShaderChunk.colorspace_pars_fragment+`
vec4 linearToOutputTexel(vec4 value){return sRGBTransferOETF(value);}
`;
let failed=false;
try{
 for(const [name,vert,frag] of [['ocean',water.vertexShader,water.fragmentShader],['sky',sky.vertexShader,sky.fragmentShader],['land',landVertex,landFragment]]){
  const v=path.join(temporary,name+'.vert'),f=path.join(temporary,name+'.frag');
  fs.writeFileSync(v,vertexPrefix+prepare(vert));fs.writeFileSync(f,fragmentPrefix+prepare(frag));
  const result=spawnSync(validator,['-l',v,f],{encoding:'utf8'});
  if(result.error)throw result.error;
  console.log(name+': '+(result.status===0?'PASS':'FAIL'));
  if(result.status!==0){console.log(result.stdout,result.stderr);failed=true;}
 }
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
if(failed)process.exitCode=1;
