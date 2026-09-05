export const landVertex=`
varying vec3 vPos;
varying vec3 vNorm;
void main(){vPos=position;vNorm=normalMatrix*normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
export const landFragment=`
uniform vec3 uBase;
uniform float uSelected;
varying vec3 vPos;
varying vec3 vNorm;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
void main(){
 vec2 p=vPos.xy;
 float f=noise(p*.7)*.5+noise(p*2.)*.25+noise(p*6.)*.125+noise(p*17.)*.0625;
 float grain=noise(p*70.);
 vec3 color=uBase*(.7+f*.8)+vec3(.025,.028,.004)*(grain-.5);
 color=mix(color,vec3(.45,.32,.13)*(.8+f*.4),uSelected);
 gl_FragColor=vec4(color,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;
