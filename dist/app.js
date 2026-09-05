import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {landVertex,landFragment} from './shaders.js';
import {createOcean,swell} from './ocean.js';
import {createFleet} from './fleet.js';
import {ROUTES,ORIGIN} from './routes.js';

const $=id=>document.getElementById(id);
const host=$('scene');
const mobile=()=>innerWidth<=650;
let renderer,scene,camera,controls,water,ship,routeLine,progressLine,portGroup,fleet;
let selected=ROUTES[0],countryMeshes=[],labelItems=[],routeSamples=[],distances=[],routeTotal=0;
// Ocean motion is the requested exhibit content; only the explicit pause control stops it.
let paused=false;
let highQuality=!mobile(),time=0,lastFrame=0,progress=0,journey='idle',cameraTween=null;
let didDrag=false,pointerStart=null,toastTimeout,routeMaterial,activeCountry=null,simVisible=true;
let sceneReady=false,homeTimer,followShip=false,waterUniforms,shaderFailure=null,oceanReady,seaMode=false;
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
const heading=new THREE.Vector2(0,1);
const projected=new THREE.Vector3();
const point=(lng,lat,y=0)=>new THREE.Vector3((lng-22)*.86,y,-(lat-37));
const originPoint=point(...ORIGIN,.42);

function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').classList.remove('visible'),3300);}
function awake(){clearTimeout(homeTimer);homeTimer=setTimeout(()=>{if(sceneReady&&!$('about').open){selectRoute(ROUTES[0]);setSeaView(false);setPaused(false);homeTimer=setTimeout(awake,90000);}},120000);}
function setPaused(value){paused=value;$('pause').textContent=paused?'▶':'Ⅱ';$('pause').setAttribute('aria-label',paused?'Включить волны':'Приостановить волны');$('pause').setAttribute('aria-pressed',String(paused));$('water-state').textContent=paused?'Океан на паузе':'Волны включены';$('app').classList.toggle('ocean-paused',paused);}

function setup(){
 renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
 renderer.debug.onShaderError=(gl,program,vertexShader,fragmentShader)=>{
  shaderFailure=new Error('Не удалось запустить графику воды. Обновите страницу или попробуйте другой браузер.');
  simVisible=false;
  console.error('Shader compilation failed',gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertexShader),gl.getShaderInfoLog(fragmentShader));
 };
 renderer.setPixelRatio(Math.min(devicePixelRatio,highQuality?1.5:1));renderer.setSize(innerWidth,innerHeight);
 renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.8;
 host.append(renderer.domElement);
 renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();toast('Графика остановлена. Восстанавливаем сцену…');simVisible=false;});
 renderer.domElement.addEventListener('webglcontextrestored',()=>location.reload());
 scene=new THREE.Scene();scene.background=new THREE.Color('#092a32');
 camera=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,.05,1500);camera.position.set(4,46,32);camera.lookAt(4,0,0);
 controls=new OrbitControls(camera,renderer.domElement);controls.target.set(4,0,0);controls.enableDamping=true;controls.dampingFactor=.07;
 controls.enableRotate=false;controls.enablePan=true;controls.screenSpacePanning=false;controls.minZoom=.5;controls.maxZoom=5;controls.zoomSpeed=.85;
 controls.mouseButtons={LEFT:THREE.MOUSE.PAN,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN};
 controls.touches={ONE:THREE.TOUCH.PAN,TWO:THREE.TOUCH.DOLLY_PAN};
 controls.addEventListener('start',()=>{cameraTween=null;followShip=false;awake();});
 scene.add(new THREE.HemisphereLight('#ceddce','#112d35',2.0));
 const sun=new THREE.DirectionalLight('#ffe5af',3.0);sun.position.set(-20,35,-15);scene.add(sun);
 createWater();createShip();fleet=createFleet(scene,ship);addMapLabels();resize();bindEvents();setPaused(paused);$('quality').textContent=highQuality?'Высокое качество':'Экономный режим';
}

function createWater(){
 const ocean=createOcean(scene,highQuality);water=ocean.water;oceanReady=ocean.ready;
 waterUniforms=water.material.uniforms;
 waterUniforms.waveStrength.value=Number($('waves').value);
}

function setSeaView(enabled){
 seaMode=enabled;cameraTween=null;followShip=enabled;
 $('app').classList.toggle('sea-view',enabled);
 $('tilt').textContent=enabled?'Карта':'Море';
 $('tilt').setAttribute('aria-label',enabled?'Вернуться к карте':'Посмотреть море рядом с кораблём');
 controls.enableRotate=enabled;controls.enablePan=!enabled;
 controls.minDistance=1.8;controls.maxDistance=enabled?12:130;
 controls.minPolarAngle=enabled?.35:0;controls.maxPolarAngle=enabled?1.12:Math.PI/2;
 controls.mouseButtons.LEFT=enabled?THREE.MOUSE.ROTATE:THREE.MOUSE.PAN;
 controls.touches.ONE=enabled?THREE.TOUCH.ROTATE:THREE.TOUCH.PAN;
 controls.touches.TWO=enabled?THREE.TOUCH.DOLLY_ROTATE:THREE.TOUCH.DOLLY_PAN;
 camera.zoom=1;camera.updateProjectionMatrix();
 if(routeLine){routeLine.visible=!enabled;progressLine.visible=!enabled;portGroup.visible=!enabled;}
 if(enabled){
  updateShip(progress);
  controls.target.copy(ship.position).add(new THREE.Vector3(0,.22,0));
  camera.position.copy(controls.target).add(new THREE.Vector3(2.4,2.5,3.9));
  camera.lookAt(controls.target);controls.update();
  $('scene-title').textContent='Морской вид · Чёрное море';
  $('scene-hint').textContent='Поверните сцену пальцем · Разведите пальцы для приближения';
 }else{
  tweenView(new THREE.Vector3(...selected.target),1,selected.scale);
  $('scene-title').textContent='Новороссийск → '+selected.port;
  $('scene-hint').textContent='Потяните карту · Выберите направление';
 }
}

function makeHull(){
 // A tapered three-dimensional bulk carrier hull, with bow pointing toward -Z.
 const contours=[{y:.07,w:.19,l:.72},{y:.26,w:.245,l:.79}];
 const vertices=[];const rings=[];
 for(const c of contours){const pts=[[-c.w,c.l*.85],[-c.w,-c.l*.6],[-c.w*.5,-c.l*.92],[0,-c.l],[c.w*.5,-c.l*.92],[c.w,-c.l*.6],[c.w,c.l*.85],[c.w*.65,c.l],[-c.w*.65,c.l]];rings.push(pts);for(const [x,z] of pts)vertices.push(x,c.y,z);}
 const n=rings[0].length,indices=[];for(let i=0;i<n;i++){let j=(i+1)%n;indices.push(i,j,n+j,i,n+j,n+i);}for(let i=1;i<n-1;i++)indices.push(n,n+i,n+i+1);
 // Contours run clockwise when seen from above: reverse faces to point outward.
 for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();return g;
}
function createShip(){
 ship=new THREE.Group();
 const hull=new THREE.Mesh(makeHull(),new THREE.MeshStandardMaterial({color:'#343e3a',roughness:.55,metalness:.25}));ship.add(hull);
 const box=(w,h,d,x,y,z,color)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.65,metalness:.15}));m.position.set(x,y,z);ship.add(m);return m;};
 box(.395,.045,1.3,0,.285,0,'#b7a06f');
 for(let i=0;i<4;i++){box(.32,.06,.21,0,.32,-.46+i*.265,'#807252');box(.27,.012,.17,0,.355,-.46+i*.265,'#494d3e');}
 box(.33,.23,.23,0,.41,.56,'#e2dfc6');box(.37,.12,.22,0,.575,.56,'#ddd9bb');box(.30,.045,.025,0,.59,.44,'#223d43');
 box(.09,.17,.09,.08,.6,.69,'#7b5541');
 const gold=new THREE.MeshStandardMaterial({color:'#c9ae6e',roughness:.55,metalness:.35});
 for(const z of [-.22,.3]){const crane=new THREE.Mesh(new THREE.CylinderGeometry(.015,.02,.37,6),gold);crane.position.set(-.12,.5,z);ship.add(crane);const boom=new THREE.Mesh(new THREE.BoxGeometry(.026,.025,.29),gold);boom.position.set(-.12,.67,z-.10);boom.rotation.x=-.22;ship.add(boom);}
 const mast=new THREE.Mesh(new THREE.CylinderGeometry(.007,.01,.24,5),gold);mast.position.set(0,.79,.56);ship.add(mast);
 ship.scale.setScalar(.90);scene.add(ship);
}

function clipRing(ring,minX,maxX,minY,maxY){
 let out=ring.slice(0,-1);
 const edges=[{inside:p=>p[0]>=minX,hit:(a,b)=>[minX,a[1]+(b[1]-a[1])*(minX-a[0])/(b[0]-a[0])]},{inside:p=>p[0]<=maxX,hit:(a,b)=>[maxX,a[1]+(b[1]-a[1])*(maxX-a[0])/(b[0]-a[0])]},{inside:p=>p[1]>=minY,hit:(a,b)=>[a[0]+(b[0]-a[0])*(minY-a[1])/(b[1]-a[1]),minY]},{inside:p=>p[1]<=maxY,hit:(a,b)=>[a[0]+(b[0]-a[0])*(maxY-a[1])/(b[1]-a[1]),maxY]}];
 for(const e of edges){const input=out;out=[];if(!input.length)break;let prev=input.at(-1);for(const cur of input){const a=e.inside(prev),b=e.inside(cur);if(b){if(!a)out.push(e.hit(prev,cur));out.push(cur);}else if(a)out.push(e.hit(prev,cur));prev=cur;}}
 return out;
}

async function loadCountries(){
 const response=await fetch('./countries.json');if(!response.ok)throw new Error('Не удалось загрузить контуры стран');
 const data=await response.json();
 const borderPoints=[];
 for(const feature of data.features){
  const polys=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
  const code=feature.properties.code;
  const base=new THREE.Color('#2f4c36');
  if(['EGY','DZA','LBY','SAU','SDN','NER','TCD','MRT','MAR','TUN','JOR','IRQ','IRN','OMN','YEM'].includes(code))base.set('#5d5b3c');
  if(['RUS','NOR','SWE','FIN'].includes(code))base.set('#324d3f');
  const mat=new THREE.ShaderMaterial({uniforms:{uBase:{value:base},uSelected:{value:0}},vertexShader:landVertex,fragmentShader:landFragment});
  const side=new THREE.MeshStandardMaterial({color:'#173631',roughness:.9});
  for(const polygon of polys){
   const outer=clipRing(polygon[0],-33,85,-2,72);if(outer.length<3)continue;
   const coords=outer.map(p=>new THREE.Vector2((p[0]-22)*.86,p[1]-37));
   const shape=new THREE.Shape(coords);
   for(const inner of polygon.slice(1)){const cut=clipRing(inner,-33,85,-2,72);if(cut.length>=3)shape.holes.push(new THREE.Path(cut.map(p=>new THREE.Vector2((p[0]-22)*.86,p[1]-37))));}
   const geometry=new THREE.ExtrudeGeometry(shape,{depth:.20,bevelEnabled:false,steps:1,curveSegments:1});
   const mesh=new THREE.Mesh(geometry,[mat,side]);mesh.rotation.x=-Math.PI/2;mesh.position.y=.035;mesh.userData={code,name:feature.properties.label,mat};
   scene.add(mesh);countryMeshes.push(mesh);
   for(let i=0;i<outer.length;i++){borderPoints.push(point(...outer[i],.248),point(...outer[(i+1)%outer.length],.248));}
  }
 }
 const borderGeo=new THREE.BufferGeometry().setFromPoints(borderPoints);
 const borders=new THREE.LineSegments(borderGeo,new THREE.LineBasicMaterial({color:'#a6a17a',transparent:true,opacity:.33}));scene.add(borders);
}

function label(text,lng,lat,kind='',y=.6){const el=document.createElement('div');el.className='map-label '+kind;el.textContent=text;$('labels').append(el);const item={el,pos:point(lng,lat,y),kind};labelItems.push(item);return item;}
let destinationLabel,shipLabel;
function addMapLabels(){
 const labels=[['ФРАНЦИЯ',2.7,46.0],['ИСПАНИЯ',-3.5,40.0],['ИТАЛИЯ',12.7,43.1],['ТУРЦИЯ',33.3,39.1],['РОССИЯ',40.1,48.0],['ГРЕЦИЯ',22.7,39.7],['ЛИВИЯ',17.5,28.6],['ЕГИПЕТ',29.6,27.4],['АЛЖИР',3.1,29.5],['САУДОВСКАЯ АРАВИЯ',44.0,24.0],['УКРАИНА',30.0,49.0],['РУМЫНИЯ',24.8,46.0],['КИПР',33.3,35.2]];
 labels.forEach(a=>label(...a));label('Чёрное море',33.0,43.0,'sea',.3);label('Средиземное море',16.8,34.0,'sea',.3);label('Красное море',36.2,24.5,'sea',.3);
 label('Новороссийск',...ORIGIN,'port',.8);destinationLabel=label('Порт-Саид',32.3,31.28,'port',.8);
 shipLabel=label('СУХОГРУЗ',...ORIGIN,'ship-label',1.2);shipLabel.el.style.display='none';
}

function buildRoute(route){
 for(const obj of [routeLine,progressLine,portGroup])if(obj){scene.remove(obj);obj.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of (Array.isArray(o.material)?o.material:[o.material]))m.dispose();});}
 // Linear segments protect narrow straits from curve overshoot onto land.
 const pts=route.points.map(p=>point(...p,.42));
 routeSamples=[pts[0]];for(let i=1;i<pts.length;i++){const steps=Math.max(2,Math.ceil(pts[i].distanceTo(pts[i-1])*20));for(let s=1;s<=steps;s++)routeSamples.push(pts[i-1].clone().lerp(pts[i],s/steps));}
 distances=[0];for(let i=1;i<routeSamples.length;i++)distances[i]=distances[i-1]+routeSamples[i].distanceTo(routeSamples[i-1]);routeTotal=distances.at(-1);
 const geo=new THREE.BufferGeometry().setFromPoints(routeSamples);
 routeMaterial=new THREE.LineDashedMaterial({color:'#f4d493',dashSize:.20,gapSize:.12,transparent:true,opacity:.88});
 routeLine=new THREE.Line(geo,routeMaterial);routeLine.computeLineDistances();scene.add(routeLine);
 const pg=new THREE.BufferGeometry().setFromPoints(routeSamples);pg.setDrawRange(0,0);progressLine=new THREE.Line(pg,new THREE.LineBasicMaterial({color:'#fff0b5'}));scene.add(progressLine);
 portGroup=new THREE.Group();
 for(const p of [routeSamples[0],routeSamples.at(-1)]){
  const dot=new THREE.Mesh(new THREE.SphereGeometry(.085,12,8),new THREE.MeshBasicMaterial({color:'#f7d18c'}));dot.position.copy(p);dot.position.y=.45;portGroup.add(dot);
  const ring=new THREE.Mesh(new THREE.RingGeometry(.14,.165,40),new THREE.MeshBasicMaterial({color:'#edcf8f',transparent:true,opacity:.5,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.copy(p);ring.position.y=.39;ring.userData.ring=true;portGroup.add(ring);
 }
 scene.add(portGroup);destinationLabel.el.textContent=route.port;destinationLabel.pos=point(...route.points.at(-1),.8);updateShip(0);
}

function atProgress(p){const dist=THREE.MathUtils.clamp(p,0,1)*routeTotal;let lo=0,hi=distances.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(distances[mid]<dist)lo=mid+1;else hi=mid;}const i=Math.max(1,lo),a=routeSamples[i-1],b=routeSamples[i];const t=(dist-distances[i-1])/(distances[i]-distances[i-1]||1);return {pos:a.clone().lerp(b,t),next:b,index:i};}
function updateShip(p){
 const shown=seaMode&&journey==='idle'?.065:p;
 const at=atProgress(shown),ahead=atProgress(Math.min(1,shown+.003));
 ship.position.copy(at.pos);ship.position.y=swell(at.pos.x,at.pos.z,time,waterUniforms.waveStrength.value)-.03;
 const dir=ahead.pos.clone().sub(at.pos);if(dir.lengthSq()>.000001){heading.set(dir.x,dir.z).normalize();ship.rotation.y=Math.atan2(-dir.x,-dir.z);}
 ship.rotation.z=Math.sin(time*1.6)*.018;ship.rotation.x=Math.sin(time*.95)*.012;

 shipLabel.pos.copy(ship.position).add(new THREE.Vector3(0,1.1,0));progressLine.geometry.setDrawRange(0,at.index+1);
 if(seaMode&&!cameraTween){const desired=ship.position.clone();desired.y=.22;const diff=desired.sub(controls.target);controls.target.add(diff);camera.position.add(diff);}
}

function renderCountryList(query=''){
 const list=$('countries');list.replaceChildren();let count=0;
 for(const route of ROUTES){if(!route.name.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')))continue;count++;const b=document.createElement('button');b.className='country-button'+(route.id===selected.id?' active':'');b.setAttribute('aria-pressed',String(route.id===selected.id));b.innerHTML=`<span class="country-name"><span class="country-number">${route.number}</span>${route.name}</span><span class="arrow">›</span>`;b.addEventListener('click',()=>selectRoute(route));list.append(b);}
 $('no-results').hidden=count>0;
}
function selectRoute(route){
 selected=route;activeCountry=route.id;progress=0;journey='idle';followShip=false;
 for(const mesh of countryMeshes)mesh.userData.mat.uniforms.uSelected.value=mesh.userData.code===route.id?1:0;
 $('destination').textContent=route.name;$('port-name').textContent=route.port;$('port-short').textContent=route.port;$('volume').textContent=route.volume.toLocaleString('ru-RU');$('country-code').textContent=route.number+' / 05';
 $('journey').innerHTML='Пройти маршрут <span>→</span>';$('reset').hidden=true;$('progress-wrap').hidden=true;shipLabel.el.style.display='none';
 $('scene-title').textContent=route.id==='SAU'?'От Чёрного моря до Красного':'Чёрное и Средиземное моря';$('scene-hint').textContent='Потяните карту · Выберите направление';
 buildRoute(route);renderCountryList($('search').value);if(seaMode)setSeaView(true);else tweenView(new THREE.Vector3(...route.target),1,route.scale);awake();
}

function tweenView(target,zoom=1,height=selected.scale,tilt=.60){
 const fittedHeight=mobile()?height*1.5:height;
 const distance=fittedHeight/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)));
 const offset=new THREE.Vector3(0,1,tilt).normalize().multiplyScalar(distance);
 cameraTween={start:performance.now(),duration:1400,fromTarget:controls.target.clone(),toTarget:target.clone(),fromPosition:camera.position.clone(),toPosition:target.clone().add(offset),fromZoom:camera.zoom,toZoom:zoom};
}
function resize(){if(!renderer)return;renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}

function toggleJourney(){
 awake();
 if(journey==='sailing'){journey='held';$('journey').innerHTML='Продолжить путь <span>→</span>';$('journey-stage').textContent='Пауза';followShip=false;return;}
 if(journey==='held'){journey='sailing';setPaused(false);$('journey').innerHTML='Приостановить <span>Ⅱ</span>';$('journey-stage').textContent='В пути';return;}
 progress=0;journey='sailing';setPaused(false);$('journey').innerHTML='Приостановить <span>Ⅱ</span>';$('reset').hidden=false;$('progress-wrap').hidden=false;shipLabel.el.style.display='block';$('journey-stage').textContent='Чёрное море';$('scene-title').textContent='Новороссийск → '+selected.port;$('scene-hint').textContent='Корабль следует по демонстрационному маршруту';
 if(seaMode)setSeaView(true);toast('Путешествие началось. Кнопка «Море» приближает к кораблю.');
}

function pick(event){
 if(seaMode)return;
 pointer.x=(event.clientX/innerWidth)*2-1;pointer.y=-(event.clientY/innerHeight)*2+1;raycaster.setFromCamera(pointer,camera);
 const hits=raycaster.intersectObjects(countryMeshes,false);
 if(hits.length){const code=hits[0].object.userData.code;const route=ROUTES.find(r=>r.id===code);if(route)selectRoute(route);else toast(`${hits[0].object.userData.name}: маршрут пока не включён в демоверсию`);return;}

}

function bindEvents(){
 $('search').addEventListener('input',e=>renderCountryList(e.target.value));$('reset').addEventListener('click',()=>selectRoute(selected));
 $('overview').addEventListener('click',()=>{setSeaView(false);tweenView(new THREE.Vector3(3,0,1),1,40);toast('Обзор направлений. Выберите страну на карте.');});
 $('pause').addEventListener('click',()=>setPaused(!paused));$('waves').addEventListener('input',e=>{waterUniforms.waveStrength.value=+e.target.value;if(paused)setPaused(false);});
 $('zoom-in').addEventListener('click',()=>{cameraTween=null;camera.zoom=Math.min(5,camera.zoom*1.25);camera.updateProjectionMatrix();});$('zoom-out').addEventListener('click',()=>{cameraTween=null;camera.zoom=Math.max(.5,camera.zoom/1.25);camera.updateProjectionMatrix();});
 $('tilt').addEventListener('click',()=>setSeaView(!seaMode));
 $('quality').addEventListener('click',()=>{highQuality=!highQuality;renderer.setPixelRatio(Math.min(devicePixelRatio,highQuality?1.5:1));renderer.setSize(innerWidth,innerHeight);$('quality').textContent=highQuality?'Высокое качество':'Экономный режим';toast(highQuality?'Высокое качество графики':'Снижено разрешение рендера для более плавной работы');});
 $('fullscreen').addEventListener('click',async()=>{try{if(!document.fullscreenElement){if(!document.documentElement.requestFullscreen){toast('Используйте полноэкранный режим браузера');return;}await document.documentElement.requestFullscreen();}else await document.exitFullscreen();}catch{toast('Полный экран недоступен в этом окне. Откройте приложение отдельно.');}});
 $('soundless').addEventListener('click',()=>$('about').showModal());$('close-about').addEventListener('click',()=>$('about').close());
 const canvas=renderer.domElement;
 canvas.addEventListener('pointerdown',e=>{if(e.isPrimary){pointerStart={x:e.clientX,y:e.clientY,id:e.pointerId};didDrag=false;}else didDrag=true;awake();});
 canvas.addEventListener('pointermove',e=>{if(pointerStart&&Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>7)didDrag=true;});
 canvas.addEventListener('pointerup',e=>{if(sceneReady&&pointerStart&&pointerStart.id===e.pointerId&&!didDrag)pick(e);pointerStart=null;});canvas.addEventListener('pointercancel',()=>{pointerStart=null;didDrag=true;});
 document.addEventListener('pointerdown',awake,{passive:true});document.addEventListener('keydown',awake);window.addEventListener('resize',resize);
 document.addEventListener('visibilitychange',()=>{simVisible=!document.hidden;lastFrame=performance.now();});
}

function animate(now){
 requestAnimationFrame(animate);if(!simVisible||!sceneReady)return;
 const dt=Math.min((now-lastFrame)/1000,.05)||0;lastFrame=now;
 if(!paused)time+=dt;waterUniforms.time.value=time;
 if(cameraTween){const t=THREE.MathUtils.clamp((now-cameraTween.start)/cameraTween.duration,0,1),e=t*t*(3-2*t);controls.target.lerpVectors(cameraTween.fromTarget,cameraTween.toTarget,e);camera.position.lerpVectors(cameraTween.fromPosition,cameraTween.toPosition,e);camera.zoom=THREE.MathUtils.lerp(cameraTween.fromZoom,cameraTween.toZoom,e);camera.updateProjectionMatrix();if(t>=1)cameraTween=null;}
 controls.update();
 // Keep panning within the geographic extent rendered by this demo.
 if(!seaMode){const old=controls.target.clone();controls.target.x=THREE.MathUtils.clamp(controls.target.x,-27,50);controls.target.z=THREE.MathUtils.clamp(controls.target.z,-30,35);camera.position.add(controls.target.clone().sub(old));}
 if(sceneReady){
  if(journey==='sailing'&&!paused){progress=Math.min(1,progress+dt/62);$('progress-number').textContent=Math.round(progress*100)+'%';$('progress-fill').style.width=(progress*100)+'%';$('journey-stage').textContent=progress<.3?'Чёрное море':progress<.5?'Через проливы':progress<.93?'В пути':'Подход к порту';if(progress===1){journey='arrived';followShip=false;$('journey').innerHTML='Повторить маршрут <span>↻</span>';$('journey-stage').textContent='В порту назначения';toast('Прибыли в порт '+selected.port);}}
  updateShip(progress);fleet.update(time,waterUniforms.waveStrength.value);
  portGroup.children.forEach(o=>{if(o.userData.ring){o.scale.setScalar(1+Math.sin(time*1.7)*.14);}});
  for(const item of labelItems){item.el.style.visibility=seaMode?'hidden':'visible';projected.copy(item.pos).project(camera);const x=(projected.x*.5+.5)*innerWidth,y=(-projected.y*.5+.5)*innerHeight;item.el.style.left=x+'px';item.el.style.top=y+'px';item.el.style.opacity=projected.z<1&&projected.z>-1&&x>-100&&x<innerWidth+100&&y>80&&y<innerHeight-70?'1':'0';}
 }
 renderer.render(scene,camera);
}

async function start(){
 try{setup();renderCountryList();requestAnimationFrame(animate);await Promise.all([loadCountries(),oceanReady]);selectRoute(ROUTES[0]);setSeaView(false);camera.position.copy(cameraTween.toPosition);controls.target.copy(cameraTween.toTarget);cameraTween=null;controls.update();fleet.update(time,waterUniforms.waveStrength.value);sceneReady=true;renderer.compile(scene,camera);renderer.render(scene,camera);if(shaderFailure)throw shaderFailure;$('loading').classList.add('dismissed');setTimeout(()=>$('loading').remove(),800);awake();}
 catch(error){console.error(error);$('loading').querySelector('h2').textContent='Не удалось открыть 3D-сцену';$('loading').querySelector('p').textContent='Проверьте, включено ли аппаратное ускорение и поддерживается ли WebGL 2. '+(error.message||'');const b=document.createElement('button');b.className='primary-button';b.style.width='240px';b.textContent='Попробовать снова';b.onclick=()=>location.reload();$('loading').append(b);}
}
start();
