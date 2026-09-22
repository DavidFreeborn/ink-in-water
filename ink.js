/* Ink in water. Native WebGL2, three-dimensional MAC-grid Boussinesq flow.
 * No curl noise, vorticity confinement, prerecorded motion, or painted wisps.
 * Coordinates are metres; simulation time is seconds. See MODEL.md.
 */
(() => {
  'use strict';
  const root = document.getElementById('ink-app') || document;
  const $ = id => root.querySelector('#' + id);
  const canvas = $('ink-canvas');
  if (!canvas) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true});
  const fail = message => {
    if ($('loading')) $('loading').hidden = true;
    if ($('ink-stage')) $('ink-stage').setAttribute('aria-busy','false');
    if ($('sim-error')) { $('sim-error').hidden = false; $('sim-error').textContent = message; }
    root.querySelectorAll('input, select, .controls button').forEach(control => {control.disabled = true;});
  };
  if (!gl || !gl.getExtension('EXT_color_buffer_float') || !gl.getExtension('OES_texture_float_linear')) {
    fail('This three-dimensional simulation needs WebGL 2 with floating-point textures. Please open it in a browser with hardware acceleration enabled.');
    return;
  }
  const vertex = `#version 300 es
  precision highp float;
  out vec2 uv;
  void main(){ vec2 p=vec2((gl_VertexID<<1)&2, gl_VertexID&2); uv=p; gl_Position=vec4(p*2.-1.,0.,1.); }`;
  const common = `#version 300 es
  precision highp float;
  precision highp int;
  precision highp sampler2D;
  in vec2 uv;
  out vec4 outColor;
  uniform vec3 n;
  uniform float columns, h, dt, time;
  uniform highp int boundaryMode, geometryMode, sceneSeed;
  uniform float fluidCount;
  uniform vec2 shapePhase;
  uniform vec4 shapeOrientation;
  uniform vec3 currentPhase;
  uniform sampler2D a,b,c,geometry;
  const vec3 X=vec3(1,0,0), Y=vec3(0,1,0), Z=vec3(0,0,1);
  // One concentration law seeds both the Eulerian field and optical quadrature.
  // Only the initial shape changes between inks; the subsequent flow is shared.
  float initialDrop(vec3 p,vec2 phases,vec4 orientation){
    vec3 direction=p;
    // Preserve the original first ink without introducing rotation roundoff.
    if(any(notEqual(orientation.xyz,vec3(0.))))direction+=2.*cross(orientation.xyz,cross(orientation.xyz,p)+orientation.w*p);
    float r=.0065*(1.+.13*sin(atan(direction.z,direction.x)*5.+phases.x)*sin(atan(length(direction.xz),direction.y)*3.+phases.y));
    return 1.-smoothstep(r-.8*h,r+.8*h,length(p));
  }
  // Pixel centres are half an integer from tile edges, so positive float
  // division finds the exact tile without expensive per-fragment integer division.
  ivec3 cell(){ivec2 f=ivec2(gl_FragCoord.xy),tile=ivec2(gl_FragCoord.xy/n.xy);return ivec3(f-tile*ivec2(n.xy),tile.x+tile.y*int(columns));}
  bool interior(ivec3 q){return all(greaterThanEqual(q,ivec3(1)))&&all(lessThanEqual(q,ivec3(n)-2));}
  ivec3 periodicCell(ivec3 q){return q-ivec3(floor((vec3(q)-.75)/(n-2.)))*ivec3(n-2.);}
  ivec3 scalarCell(ivec3 q){return boundaryMode==1?periodicCell(q):clamp(q,ivec3(1),ivec3(n)-2);}
  ivec3 faceCell(ivec3 q,int axis){if(boundaryMode==1)return periodicCell(q);ivec3 lo=ivec3(1);lo[axis]=0;return clamp(q,lo,ivec3(n)-2);}
  vec4 at(sampler2D s, ivec3 q){q=clamp(q,ivec3(0),ivec3(n)-1);int row=int((float(q.z)+.25)/columns);return texelFetch(s,ivec2((q.z-row*int(columns))*int(n.x)+q.x,row*int(n.y)+q.y),0);}
  bool fluidCell(ivec3 q){return interior(q)&&(geometryMode==0||at(geometry,q).a>0.);}
  float cellVolume(ivec3 q){return !interior(q)?0.:geometryMode==0?1.:at(geometry,q).a;}
  float faceWeight(ivec3 q,int axis){
    if(boundaryMode==1)return 1.;
    if(q[axis]<=0||q[axis]>=int(n[axis])-2)return 0.;
    return geometryMode==0?1.:at(geometry,q)[axis];
  }
  vec3 wallVelocity(vec3 v,ivec3 q){if(boundaryMode==0)for(int axis=0;axis<3;axis++)if(faceWeight(faceCell(q,axis),axis)==0.)v[axis]=0.;return v;}
  // Each retained voxel lies wholly inside the analytic container. Tracer
  // reflection and the finite-volume mask therefore describe the same wall.
  bool physicalFluidCell(ivec3 q){
    vec3 centre=(vec3(q)+.5)*h;
    if(any(lessThan(q,ivec3(0)))||any(greaterThanEqual(centre,vec3(.08,.12,.08))))return false;
    if(geometryMode==0)return true;
    vec3 edge=abs(centre-vec3(.04,.06,.04))+.5*h;
    return geometryMode==1?dot(edge.xz,edge.xz)<=.0016:dot(edge,edge)<=.0016;
  }
  vec3 velocityAt(sampler2D s,ivec3 q){
    // Projection already fills every stored ghost component by extrapolation.
    // Used for projected fields only; provisional faces are handled explicitly.
    return at(s,q).xyz;
  }
  vec4 concentrationAt(sampler2D s,ivec3 q){return at(s,scalarCell(q));}
  float pressureAt(sampler2D s,ivec3 q){return at(s,q).r;}
  vec4 interp(sampler2D s,vec3 p){
    p=boundaryMode==1?mod(p-1.,n-2.)+1.:clamp(p,vec3(0),n-1.); float z=floor(p.z); vec2 size=vec2(textureSize(s,0));
    vec2 p0=(vec2(mod(z,columns),floor(z/columns))*n.xy+p.xy+.5)/size;
    float z1=min(z+1.,n.z-1.);
    vec2 p1=(vec2(mod(z1,columns),floor(z1/columns))*n.xy+p.xy+.5)/size;
    return mix(textureLod(s,p0,0.),textureLod(s,p1,0.),fract(p.z));
  }
  vec3 vel(sampler2D s,vec3 p){return vec3(interp(s,p-.5*X).x,interp(s,p-.5*Y).y,interp(s,p-.5*Z).z);}
  vec3 trace(sampler2D s,vec3 p,float d){vec3 v=vel(s,p);return p-d/h*vel(s,p-.5*d/h*v);}
  vec2 bounds(sampler2D s,vec3 p,int channel){
    p=boundaryMode==1?mod(p-1.,n-2.)+1.:clamp(p,vec3(0),n-1.);
    ivec3 q=ivec3(floor(p));float lo=1e20,hi=-1e20;
    for(int k=0;k<2;k++)for(int j=0;j<2;j++)for(int i=0;i<2;i++){float v=at(s,q+ivec3(i,j,k))[channel];lo=min(lo,v);hi=max(hi,v);}return vec2(lo,hi);
  }
  `;
  const programs = {};
  function program(name, body, header=common, vertexSource=vertex) {
    const compile = (kind, source) => {
      const sh=gl.createShader(kind);gl.shaderSource(sh,source);gl.compileShader(sh);
      if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)) throw Error(name+': '+gl.getShaderInfoLog(sh));
      return sh;
    };
    const vs=compile(gl.VERTEX_SHADER,vertexSource), fs=compile(gl.FRAGMENT_SHADER,header+body);
    const p=gl.createProgram();gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);
    gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));
    const uniforms={};for(let i=0;i<gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS);i++){const u=gl.getActiveUniform(p,i);uniforms[u.name]={loc:gl.getUniformLocation(p,u.name),type:u.type};}
    return programs[name]={p,uniforms};
  }
  let fields=[], levels=[], velocity, scalarGroups=[], buoyancy, forwardV, forwardC, h, dims, speed, reductions=[], tracerSets=[], particleSide=128, opticalField, opticalScratch;
  const renderState={program:null,width:0,height:0,activeUnit:-1,textures:[]};
  function invalidateRenderState(){renderState.program=null;renderState.width=0;renderState.height=0;renderState.activeUnit=-1;renderState.textures=[];}
  const particleRendering=!!gl.getExtension('EXT_float_blend');
  function grid(nx,ny,nz){return {active:[nx,ny,nz],n:[nx+2,ny+2,nz+2],columns:Math.ceil(Math.sqrt(nz+2)),h:.08/nx};}
  function field(g, channels=1) {
    const width=g.n[0]*g.columns,height=g.n[1]*Math.ceil(g.n[2]/g.columns);
    const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
    renderState.activeUnit=-1;renderState.textures=[];
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    // Full precision also makes pressure residuals and mass diagnostics useful.
    gl.texImage2D(gl.TEXTURE_2D,0,channels===4?gl.RGBA32F:gl.R32F,width,height,0,channels===4?gl.RGBA:gl.RED,gl.FLOAT,null);
    const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Floating-point framebuffer unavailable');
    const f={g,tex,fb,width,height,channels};fields.push(f);return f;
  }
  function pair(g,channels=1){const x=[field(g,channels),field(g,channels)];x.swap=()=>{[x[0],x[1]]=[x[1],x[0]];};return x;}
  function discardField(f){if(!f)return;gl.deleteTexture(f.tex);gl.deleteFramebuffer(f.fb);fields.splice(fields.indexOf(f),1);renderState.textures=[];}
  function draw(name,target,textures={},extra={},primitive=gl.TRIANGLES,count=3){
    const p=programs[name];if(renderState.program!==p.p){gl.useProgram(p.p);renderState.program=p.p;}gl.bindFramebuffer(gl.FRAMEBUFFER,target?target.fb:null);
    const width=target?target.width:canvas.width,height=target?target.height:canvas.height;
    if(renderState.width!==width||renderState.height!==height){gl.viewport(0,0,width,height);renderState.width=width;renderState.height=height;}
    const g=target?target.g:velocity[0].g;
    const vals={n:g.n,columns:g.columns,h:g.h,dt:DT,time:simTime,boundaryMode:boundary==='periodic'?1:0,geometryMode:boundary==='periodic'||containerShape==='cuboid'?0:containerShape==='cylinder'?1:2,fluidCount:g.fluidCount||1,sceneSeed:experimentSeed|0,shapePhase,currentPhase,...extra};
    if(p.uniforms.geometry)textures={...textures,geometry:g.geometry||levels[0].geometry};
    let unit=0;
    for(const [key,f]of Object.entries(textures)){const u=p.uniforms[key];if(!u)continue;
      if(renderState.textures[unit]!==f.tex){if(renderState.activeUnit!==unit){gl.activeTexture(gl.TEXTURE0+unit);renderState.activeUnit=unit;}gl.bindTexture(gl.TEXTURE_2D,f.tex);renderState.textures[unit]=f.tex;}
      if(u.value!==unit){gl.uniform1i(u.loc,unit);u.value=unit;}unit++;
    }
    for(const [key,v]of Object.entries(vals)){const u=p.uniforms[key];if(!u)continue;
      if(u.type===gl.FLOAT||u.type===gl.INT){if(u.value===v)continue;u.value=v;if(u.type===gl.FLOAT)gl.uniform1f(u.loc,v);else gl.uniform1i(u.loc,v);}
      else if(u.type===gl.FLOAT_VEC2||u.type===gl.FLOAT_VEC3||u.type===gl.FLOAT_VEC4){const count=u.type===gl.FLOAT_VEC2?2:u.type===gl.FLOAT_VEC3?3:4;if(u.value&&u.value.every((x,i)=>x===v[i]))continue;u.value=Array.from(v).slice(0,count);if(count===2)gl.uniform2fv(u.loc,v);else if(count===3)gl.uniform3fv(u.loc,v);else gl.uniform4fv(u.loc,v);}
    }
    gl.drawArrays(primitive,0,count);
  }
  let DT=.01;
  let simTime=0, stepIndex=0, angle=0, running=!reduced.matches, lastFrame=0, accumulator=0, raf=0, destroyed=false, visible=true;
  let quality='standard', initialMotion='gentle', boundary='container',containerShape='cuboid',currentStrength=1;
  const MAX_INKS=3, REFERENCE_COLUMN=.002, DEFAULT_COLOUR='#3657b2';
  let inks=[{id:1,density:.04,colour:DEFAULT_COLOUR}], activeInkIndex=0, nextInkId=2, dropCentres=[];
  const palette={blue:[780,540,180],amber:[140,450,1100],red:[160,800,950],green:[700,200,600],violet:[460,950,240],black:[800,800,800]};
  const normaliseHex=value=>/^#?[0-9a-f]{6}$/i.test(String(value).trim())?'#'+String(value).trim().replace(/^#/,'').toLowerCase():null;
  const absorptionFor=colour=>colour===DEFAULT_COLOUR?[780,540,180]:[1,3,5].map(i=>-Math.log(Math.max(1/65535,parseInt(colour.slice(i,i+2),16)/255))/REFERENCE_COLUMN);
  const hexForAbsorption=coefficients=>'#'+coefficients.map(value=>Math.round(255*Math.exp(-value*REFERENCE_COLUMN)).toString(16).padStart(2,'0')).join('');
  const selectedInk=()=>inks[activeInkIndex];
  const domainValue=()=>boundary==='periodic'?'periodic':containerShape;
  function chooseDropCentres(){
    if(inks.length===1)return [[.04,.08,.04]];
    if(inks.length===2)return [[.028,.08,.04],[.052,.08,.04]];
    // Nineteen sites fit all three containers without shrinking the drops.
    // At Standard/Fine, their 18 mm separation also separates smoothed edges.
    const sites=[];
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)if(x*x+y*y+z*z<=2)sites.push([.04+.018*x,.06+.018*y,.04+.018*z]);
    return sites.map((position,index)=>({position,key:seedUnit(experimentSeed^Math.imul(index+1,0x9e3779b9))})).sort((a,b)=>a.key-b.key).slice(0,inks.length).map(site=>site.position);
  }
  let manualSteps=0, playbackSpeed=1;
  function freshSeed(){return crypto.getRandomValues(new Uint32Array(1))[0];}
  function seedUnit(value){value=Math.imul(value^(value>>>16),0x7feb352d);value=Math.imul(value^(value>>>15),0x846ca68b);return ((value^(value>>>16))>>>0)/4294967296;}
  let experimentSeed=freshSeed(), shapePhase, currentPhase;
  function chooseSeed(value){
    experimentSeed=value>>>0;
    shapePhase=[0xa511e9b3,0x63d83595].map(salt=>2*Math.PI*seedUnit(experimentSeed^salt));
    currentPhase=[0xb5297a4d,0x68e31da4,0x1b56c4e9].map(salt=>2*Math.PI*seedUnit(experimentSeed^salt));
    if($('seed'))$('seed').value=String(experimentSeed);
  }
  function initialShapeForInk(id){
    if(id===1)return{phases:shapePhase.slice(),orientation:[0,0,0,1]};
    // Stable identities keep their perturbation when another ink is removed.
    // ID 1 retains the original shape; all other keys select independent phases
    // and a uniform spatial orientation, with the same radius and amplitude.
    // This shape namespace is separate from current and tracer random keys.
    const key=experimentSeed^Math.imul(id-1,0xd1b54a35)^0x94d049bb;
    const phases=[0xa511e9b3,0x63d83595].map(salt=>2*Math.PI*seedUnit(key^salt));
    const u=[0x243f6a88,0x85a308d3,0x13198a2e].map(salt=>seedUnit(key^salt));
    const lower=Math.sqrt(1-u[0]),upper=Math.sqrt(u[0]),azimuth=2*Math.PI*u[1],polar=2*Math.PI*u[2];
    return{phases,orientation:[lower*Math.sin(azimuth),lower*Math.cos(azimuth),upper*Math.sin(polar),upper*Math.cos(polar)]};
  }
  chooseSeed(experimentSeed);
  const cameraCenter=.06;
  let cameraSpan=.14;
  try {
    program('makeGeometry',`void main(){ivec3 q=cell();bool fluid=physicalFluidCell(q-1);vec3 faces=vec3(0);
      if(fluid)for(int axis=0;axis<3;axis++){ivec3 e=ivec3(0);e[axis]=1;faces[axis]=physicalFluidCell(q-1+e)?1.:0.;}
      outColor=vec4(faces,fluid?1.:0.);
    }`);
    program('coarsenGeometry',`uniform vec3 sourceN;uniform float sourceColumns;
      vec4 source(ivec3 p){int row=int((float(p.z)+.25)/sourceColumns);return texelFetch(a,ivec2((p.z-row*int(sourceColumns))*int(sourceN.x)+p.x,row*int(sourceN.y)+p.y),0);}
      void main(){ivec3 q=cell();if(!interior(q)){outColor=vec4(0);return;}vec4 aggregate=vec4(0);
        for(int k=0;k<2;k++)for(int j=0;j<2;j++)for(int i=0;i<2;i++){vec4 fine=source(2*q-1+ivec3(i,j,k));aggregate.a+=fine.a*.125;if(i==1)aggregate.x+=fine.x*.25;if(j==1)aggregate.y+=fine.y*.25;if(k==1)aggregate.z+=fine.z*.25;}
        outColor=aggregate;
      }`);
    program('fluidVolume',`void main(){ivec3 q=cell();outColor=vec4(cellVolume(q),0,0,1);}`);
    program('seed',`uniform vec3 centre0,centre1,centre2,centre3;uniform vec4 activeSpecies;
    uniform vec2 phases0,phases1,phases2,phases3;
    uniform vec4 orientation0,orientation1,orientation2,orientation3;
    void main(){ivec3 q=cell();if(!fluidCell(q)){outColor=vec4(0);return;}
      vec3 p=(vec3(q)-.5)*h;
      outColor=activeSpecies*vec4(initialDrop(p-centre0,phases0,orientation0),initialDrop(p-centre1,phases1,orientation1),initialDrop(p-centre2,phases2,orientation2),initialDrop(p-centre3,phases3,orientation3));
    }`);
    program('sumBuoyancy',`uniform vec4 coefficients,meanValues;
      void main(){ivec3 q=cell();if(q.z>=int(n.z)){outColor=vec4(0);return;}
        vec4 concentration=concentrationAt(b,q);
        if(boundaryMode==1)concentration-=meanValues;
        outColor=vec4(at(a,q).r+dot(coefficients,concentration),0,0,1);
      }`);
    program('seedAmbient',`uniform float currentAmplitude;
      void main(){ivec3 q=cell();if(q.z>=int(n.z)){outColor=vec4(0);return;}
        vec3 phase=((vec3(q)-.5)*h-vec3(.04,.080,.04))*314.159265+currentPhase;
        vec3 v=currentAmplitude/1.414213562*vec3(sin(phase.z)+cos(phase.y),sin(phase.x)+cos(phase.z),sin(phase.y)+cos(phase.x));
        outColor=vec4(v,0);
      }`);
    program('advectV',`void main(){ivec3 q=cell();if(q.z>=int(n.z)){outColor=vec4(0);return;}
      vec3 px=trace(a,vec3(faceCell(q,0))+.5*X,dt)-.5*X,py=trace(a,vec3(faceCell(q,1))+.5*Y,dt)-.5*Y,pz=trace(a,vec3(faceCell(q,2))+.5*Z,dt)-.5*Z;
      outColor=vec4(wallVelocity(vec3(interp(a,px).x,interp(a,py).y,interp(a,pz).z),q),0);
    }`);
    program('correctV',`void main(){ivec3 q=cell();if(q.z>=int(n.z)){outColor=vec4(0);return;}if(boundaryMode==1)q=periodicCell(q);vec3 p=vec3(q);
      vec3 old=velocityAt(a,q),fw=at(b,q).xyz;
      vec3 rx=trace(a,p+.5*X,-dt)-.5*X,ry=trace(a,p+.5*Y,-dt)-.5*Y,rz=trace(a,p+.5*Z,-dt)-.5*Z;
      vec3 rev=vec3(interp(b,rx).x,interp(b,ry).y,interp(b,rz).z);
      vec3 v=fw+.5*(old-rev);
      vec3 fx=trace(a,p+.5*X,dt)-.5*X,fy=trace(a,p+.5*Y,dt)-.5*Y,fz=trace(a,p+.5*Z,dt)-.5*Z;
      vec2 bx=bounds(a,fx,0),by=bounds(a,fy,1),bz=bounds(a,fz,2);
      v=clamp(v,vec3(bx.x,by.x,bz.x),vec3(bx.y,by.y,bz.y));
      vec3 lap=velocityAt(a,q+ivec3(1,0,0))+velocityAt(a,q-ivec3(1,0,0))+velocityAt(a,q+ivec3(0,1,0))+velocityAt(a,q-ivec3(0,1,0))+velocityAt(a,q+ivec3(0,0,1))+velocityAt(a,q-ivec3(0,0,1))-6.*old;
      if(geometryMode>0){lap=vec3(0);for(int component=0;component<3;component++)for(int axis=0;axis<3;axis++)for(int direction=-1;direction<=1;direction+=2){ivec3 e=ivec3(0);e[axis]=direction;float neighbour=at(a,q+e)[component];if(faceWeight(q+e,component)==0.)neighbour=axis==component?0.:old[component];lap[component]+=neighbour-old[component];}}
      v+=dt*1e-6/(h*h)*lap;
      float contrast=.5*(at(c,scalarCell(q)).r+at(c,scalarCell(q+ivec3(0,1,0))).r);
      v.y-=dt*9.81*contrast;
      outColor=vec4(wallVelocity(v,q),0);
    }`);
    program('divergence',`void main(){ivec3 q=cell();if(!fluidCell(q)){outColor=vec4(0);return;}vec3 v=at(a,q).xyz;
      float l=at(a,q-ivec3(1,0,0)).x,d=at(a,q-ivec3(0,1,0)).y,bk=at(a,q-ivec3(0,0,1)).z;
      outColor=vec4((v.x-l+v.y-d+v.z-bk)/h,0,0,1);
    }`);
    program('jacobi',`void main(){ivec3 q=cell();if(q.z>=int(n.z)){outColor=vec4(0);return;}q=scalarCell(q);if(!fluidCell(q)){outColor=vec4(0);return;}
      float sum=0.,diagonal=6.;for(int axis=0;axis<3;axis++){ivec3 e=ivec3(0);e[axis]=1;
        float minus=faceWeight(q-e,axis),plus=faceWeight(q,axis);diagonal-=2.-minus-plus;
        sum+=minus*pressureAt(a,q-e)+plus*pressureAt(a,q+e);}
      outColor=vec4(diagonal>0.?mix(at(a,q).r,(sum-h*h*at(b,q).r)/diagonal,.72):0.,0,0,1);
    }`);
    program('residual',`void main(){ivec3 q=cell();if(!fluidCell(q)){outColor=vec4(0);return;}
      float centre=at(a,q).r,sum=0.;for(int axis=0;axis<3;axis++){ivec3 e=ivec3(0);e[axis]=1;sum+=faceWeight(q-e,axis)*(pressureAt(a,q-e)-centre)+faceWeight(q,axis)*(pressureAt(a,q+e)-centre);}
      outColor=vec4(at(b,q).r-sum/(h*h),0,0,1);
    }`);
    program('restrict',`uniform vec3 sourceN;uniform float sourceColumns;
      float source(ivec3 p){int row=int((float(p.z)+.25)/sourceColumns);return texelFetch(a,ivec2((p.z-row*int(sourceColumns))*int(sourceN.x)+p.x,row*int(sourceN.y)+p.y),0).r;}
      void main(){ivec3 q=cell();if(!fluidCell(q)){outColor=vec4(0);return;}float sum=0.;for(int k=0;k<2;k++)for(int j=0;j<2;j++)for(int i=0;i<2;i++)sum+=source(2*q-1+ivec3(i,j,k));outColor=vec4(sum*.125,0,0,1);}
    `);
    program('prolong',`uniform vec3 sourceN;uniform float sourceColumns;uniform sampler2D sourceGeometry;
      vec2 sourceAt(ivec3 p){p=boundaryMode==1?p-ivec3(floor((vec3(p)-.75)/(sourceN-2.)))*ivec3(sourceN-2.):clamp(p,ivec3(1),ivec3(sourceN)-2);
        int row=int((float(p.z)+.25)/sourceColumns);ivec2 pixel=ivec2((p.z-row*int(sourceColumns))*int(sourceN.x)+p.x,row*int(sourceN.y)+p.y);
        float weight=geometryMode==0||texelFetch(sourceGeometry,pixel,0).a>0.?1.:0.;return vec2(texelFetch(b,pixel,0).r*weight,weight);}
      float source(vec3 p){ivec3 q=ivec3(floor(p));vec3 f=fract(p);vec2 value=vec2(0);for(int k=0;k<2;k++)for(int j=0;j<2;j++)for(int i=0;i<2;i++)value+=sourceAt(q+ivec3(i,j,k))*(i==0?1.-f.x:f.x)*(j==0?1.-f.y:f.y)*(k==0?1.-f.z:f.z);return value.x/max(value.y,1e-20);}
      void main(){ivec3 q=cell();if(q.z>=int(n.z)){outColor=vec4(0);return;}q=scalarCell(q);if(!fluidCell(q)){outColor=vec4(0);return;}outColor=vec4(at(a,q).r+source(vec3(q)*.5+.25),0,0,1);}
    `);
    program('project',`float projectedFace(ivec3 q,int axis){ivec3 e=ivec3(0);e[axis]=1;return at(a,q)[axis]-(pressureAt(b,q+e)-pressureAt(b,q))/h;}
      void main(){ivec3 q=cell();if(q.z>=int(n.z)){outColor=vec4(0);return;}
      ivec3 px=faceCell(q,0),py=faceCell(q,1),pz=faceCell(q,2);
      vec3 grad=vec3(pressureAt(b,px+ivec3(1,0,0))-pressureAt(b,px),pressureAt(b,py+ivec3(0,1,0))-pressureAt(b,py),pressureAt(b,pz+ivec3(0,0,1))-pressureAt(b,pz))/h;
      vec3 provisional=vec3(at(a,px).x,at(a,py).y,at(a,pz).z);
      vec3 result=wallVelocity(provisional-grad,q);
      // Even tangential extension supplies interpolation samples in the first
      // solid layer. Faces separating fluid and solid stay exactly impermeable.
      if(geometryMode>0)for(int component=0;component<3;component++){
        ivec3 p=faceCell(q,component),normal=ivec3(0);normal[component]=1;
        if(faceWeight(p,component)==0.&&!fluidCell(p)&&!fluidCell(p+normal)){
          float sum=0.,count=0.;for(int axis=0;axis<3;axis++)if(axis!=component)for(int direction=-1;direction<=1;direction+=2){ivec3 e=ivec3(0);e[axis]=direction;ivec3 neighbour=p+e;if(faceWeight(neighbour,component)>0.){sum+=projectedFace(neighbour,component);count+=1.;}}
          result[component]=count>0.?sum/count:0.;
        }
      }
      outColor=vec4(result,0);
    }`);
    program('speed',`void main(){ivec3 q=cell();if(!fluidCell(q)){outColor=vec4(0);return;}
      vec3 v=at(a,q).xyz;float left=at(a,q-ivec3(1,0,0)).x;
      float down=at(a,q-ivec3(0,1,0)).y;float back=at(a,q-ivec3(0,0,1)).z;
      float outgoing=max(v.x,0.)+max(-left,0.)+max(v.y,0.)+max(-down,0.)+max(v.z,0.)+max(-back,0.);
      outColor=vec4(outgoing,0,0,1);
    }`);
    program('reduce',`void main(){ivec2 q=ivec2(gl_FragCoord.xy)*2;ivec2 size=textureSize(a,0);float m=0.;
      for(int j=0;j<2;j++)for(int i=0;i<2;i++){ivec2 p=q+ivec2(i,j);if(all(lessThan(p,size)))m=max(m,texelFetch(a,p,0).r);}outColor=vec4(m,0,0,1);
    }`);
    program('reduceSum',`void main(){ivec2 q=ivec2(gl_FragCoord.xy)*2;ivec2 size=textureSize(a,0);float sum=0.;
      for(int j=0;j<2;j++)for(int i=0;i<2;i++){ivec2 p=q+ivec2(i,j);if(all(lessThan(p,size)))sum+=texelFetch(a,p,0).r;}outColor=vec4(sum,0,0,1);
    }`);
    program('centerRhs',`void main(){ivec3 q=cell();if(!fluidCell(q)){outColor=vec4(0);return;}outColor=vec4(at(a,q).r-texelFetch(b,ivec2(0),0).r*cellVolume(q)/fluidCount,0,0,1);}`);
    program('pressureGauge',`void main(){ivec3 q=cell();if(q.z>=int(n.z)){outColor=vec4(0);return;}q=scalarCell(q);if(!fluidCell(q)){outColor=vec4(0);return;}ivec3 reference=geometryMode==0?ivec3(1):ivec3(n*.5);outColor=vec4(at(a,q).r-at(a,reference).r,0,0,1);}`);
    program('square',`void main(){ivec3 q=cell();if(!fluidCell(q)){outColor=vec4(0);return;}float value=at(a,q).r;outColor=vec4(value*value,0,0,1);}`);
    program('activeValue',`uniform int channel;void main(){ivec3 q=cell();outColor=fluidCell(q)?vec4(at(a,q)[channel],0,0,1):vec4(0);}`);
    program('scalarGhosts',`void main(){ivec3 q=cell();if(q.z>=int(n.z)){outColor=vec4(0);return;}q=scalarCell(q);outColor=fluidCell(q)?at(a,q):vec4(0);}`);
    program('transportC',`// Append this body to 'common' using program('transportC', body).
// Bind a = projected MAC velocity, b = current RK stage concentration,
// c = original concentration at the start of this scalar timestep.
// rkStage = 0: forward Euler; rkStage = 1: final SSP-RK2 combination.
// All face fluxes use the same oriented left cell and hence cancel globally.
// Do not clamp the output: that would destroy this conservation property.
uniform int rkStage;
const float scalarDiffusivity = 1e-9;

float scalarMCSlope(float leftDifference, float rightDifference) {
  if (leftDifference * rightDifference <= 0.) return 0.;
  return sign(leftDifference) * min(.5*abs(leftDifference+rightDifference), min(2.*abs(leftDifference), 2.*abs(rightDifference)));
}

// Flux through the positive face of 'left', positive toward increasing axis.
vec4 scalarFaceFlux(ivec3 left, int axis) {
  ivec3 offset = ivec3(0);
  offset[axis] = 1;
  // A periodic seam has one canonical face, so both cells use identical fluxes.
  if(boundaryMode==1)left=periodicCell(left);
  else if(faceWeight(left,axis)==0.)return vec4(0.);
  float speed = at(a, left)[axis];
  ivec3 donor = left;
  if (speed < 0.) donor += offset;

  vec4 center = concentrationAt(b, donor);
  vec4 lower = concentrationAt(b, donor - offset);
  vec4 upper = concentrationAt(b, donor + offset);
  if(geometryMode>0){if(!fluidCell(donor-offset))lower=center;if(!fluidCell(donor+offset))upper=center;}
  vec4 slope = vec4(scalarMCSlope(center.x-lower.x,upper.x-center.x),scalarMCSlope(center.y-lower.y,upper.y-center.y),scalarMCSlope(center.z-lower.z,upper.z-center.z),scalarMCSlope(center.w-lower.w,upper.w-center.w));
  vec4 faceConcentration = center + (speed < 0. ? -.5 : .5) * slope;

  // These are cell averages on the two sides of this very same face.
  vec4 leftConcentration = speed < 0. ? lower : center;
  vec4 rightConcentration = speed < 0. ? center : upper;
  vec4 diffusiveFlux = -scalarDiffusivity * (rightConcentration - leftConcentration) / h;
  return speed * faceConcentration + diffusiveFlux;
}

void main() {
  ivec3 q = cell();
  if (q.z>=int(n.z)) { outColor = vec4(0.); return; }
  q=scalarCell(q);
  if(!fluidCell(q)){outColor=vec4(0);return;}
  vec4 xp = scalarFaceFlux(q, 0);
  vec4 xm = scalarFaceFlux(q - ivec3(1,0,0), 0);
  vec4 yp = scalarFaceFlux(q, 1);
  vec4 ym = scalarFaceFlux(q - ivec3(0,1,0), 1);
  vec4 zp = scalarFaceFlux(q, 2);
  vec4 zm = scalarFaceFlux(q - ivec3(0,0,1), 2);
  vec4 current = at(b, q).rgba;
  vec4 euler = current - (dt / h) * ((xp - xm) + (yp - ym) + (zp - zm));
  vec4 result = euler;
  if (rkStage == 1) result = .5 * at(c, q).rgba + .5 * euler;
  outColor = result;
}

`);
    program('render',`uniform vec2 resolution;uniform float angle,cameraCenter,cameraSpan;uniform vec3 absorption0,absorption1,absorption2,absorption3;
      void main(){
        // Orthographic transmission image, with a slight elevation to reveal depth.
        float ca=cos(angle),sa=sin(angle);vec3 right=vec3(ca,0.,-sa),up=vec3(.12*sa,.9928,.12*ca),dir=normalize(cross(right,up));
        float aspect=resolution.x/resolution.y;vec2 p=(uv-.5)*vec2(aspect,1.)*cameraSpan;
        vec3 ro=vec3(.04,cameraCenter,.04)+right*p.x+up*p.y+dir*.2;vec3 rd=-dir;
        vec3 low=(vec3(0)-ro)/rd,high=(vec3(.08,.12,.08)-ro)/rd;
        vec3 mn=min(low,high),mx=max(low,high);float nearT=max(max(mn.x,mn.y),mn.z),farT=min(min(mx.x,mx.y),mx.z);
        vec4 optical=vec4(0.);
        if(nearT<farT){
          float stepSize=.00042;float start=max(nearT,0.);
          // Fixed quadrature positions: no temporal noise or fabricated detail.
          for(int i=0;i<300;i++){float t=start+(float(i)+.5)*stepSize;if(t>farT)break;vec3 pos=ro+rd*t;vec4 density=max(vec4(0.),interp(a,pos/h+.5));optical+=density*stepSize;}
        }
        vec3 previous=texture(b,uv).rgb;
        outColor=vec4(previous+absorption0*optical.x+absorption1*optical.y+absorption2*optical.z+absorption3*optical.w,0.);
      }
    `);
    program('seedParticles',`uniform float particleSide;uniform int inkKey;uniform vec3 dropCentre;
      uint seedHash(uint x){x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return x;}
      float seedUnit(uint x){return (float(seedHash(x)>>8u)+.5)/16777216.;}
      void main(){ivec2 pixel=ivec2(gl_FragCoord.xy);int id=pixel.x+pixel.y*int(n.x);int side=int(particleSide);
        int count=side*side*side;if(id>=count){outColor=vec4(0);return;}
        int localId=id;uint sampleKey=uint(id)^uint(sceneSeed)^(uint(inkKey)*0x9e3779b9u);
        vec3 q=vec3(localId%side,(localId/side)%side,localId/(side*side));float spacing=.018/particleSide;
        vec3 jitter=vec3(seedUnit(sampleKey^0xa511e9b3u),seedUnit(sampleKey^0x63d83595u),seedUnit(sampleKey^0x9e3779b9u))-.5;
        vec3 p=(q+.5+jitter*.7)*spacing-.009;
        float concentration=initialDrop(p,shapePhase,shapeOrientation);
        p+=dropCentre;
        if(geometryMode>0&&!physicalFluidCell(ivec3(floor(p/h))))concentration=0.;
        outColor=vec4(p,concentration*spacing*spacing*spacing);
      }
    `);
    program('advectParticles',`uniform sampler2D ids;uniform int stepIndex,inkKey;
      uint mixBits(uint x){x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return x;}
      float randomUnit(uint x){return (float(mixBits(x)>>8u)+.5)/16777216.;}
      vec3 reflectVoxelPath(vec3 start,vec3 displacement){
        ivec3 q=ivec3(floor(start/h));vec3 p=start,d=displacement;
        // Traverse every crossed voxel face. Ordinary steps cross fewer than
        // two cells; the generous bound also covers repeated corner reflections.
        for(int crossing=0;crossing<64;crossing++){
          vec3 times=vec3(1e30);
          for(int axis=0;axis<3;axis++)if(abs(d[axis])>1e-20){float edge=(float(q[axis])+(d[axis]>0.?1.:0.))*h;times[axis]=max(0.,(edge-p[axis])/d[axis]);}
          int axis=times.x<times.y?0:1;if(times.z<times[axis])axis=2;
          float fraction=times[axis];if(fraction>=1.)return clamp(p+d,(vec3(q)+1e-5)*h,(vec3(q)+1.-1e-5)*h);
          p+=fraction*d;d*=1.-fraction;int direction=d[axis]>0.?1:-1;ivec3 next=q;next[axis]+=direction;
          if(physicalFluidCell(next))q=next;else d[axis]=-d[axis];
          // Keep the floating-point position on its assigned side of the face.
          p[axis]=clamp(p[axis],(float(q[axis])+1e-5)*h,(float(q[axis]+1)-1e-5)*h);
        }
        return p;
      }
      void main(){ivec2 pixel=ivec2(gl_FragCoord.xy);vec4 old=texelFetch(b,pixel,0);if(old.w<=0.){outColor=old;return;}
        vec3 p=old.xyz;vec3 gridP=p/h+.5;vec3 v0=vel(a,gridP);vec3 mid=gridP+.5*dt/h*v0;vec3 v1=vel(a,mid);p+=dt*v1;
        // Brownian displacement represents molecular diffusion, not a flow force.
        // Integer sample/step keys avoid the large-float sine hash's biased drift.
        // Original IDs survive compaction, so no dye-bearing sample is changed.
        uint seed=uint(sceneSeed)^uint(texelFetch(ids,pixel,0).r)^(uint(stepIndex)*0x9e3779b9u)^(uint(inkKey)*0x85ebca6bu);
        vec3 random=vec3(randomUnit(seed^0xa511e9b3u),randomUnit(seed^0x63d83595u),randomUnit(seed^0x9e3779b9u));
        vec3 random2=vec3(randomUnit(seed^0xb5297a4du),randomUnit(seed^0x68e31da4u),randomUnit(seed^0x1b56c4e9u));
        vec3 gaussian=sqrt(-2.*log(random))*cos(6.2831853*random2);
        p+=sqrt(2.e-9*dt)*gaussian;
        vec3 size=vec3(.08,.12,.08);
        p=boundaryMode==1?mod(p,size):geometryMode==0?size-abs(mod(p,2.*size)-size):reflectVoxelPath(old.xyz,p-old.xyz);
        outColor=vec4(p,old.w);
      }
    `);
    const pointVertex=`#version 300 es
      precision highp float;precision highp int;precision highp sampler2D;
      uniform sampler2D a,b;uniform float angle,cameraCenter,cameraSpan,interpolation;uniform vec2 resolution;uniform highp int boundaryMode;
      uniform vec3 absorption;
      out float opticalWeight;flat out vec3 opticalAbsorption;
      void main(){ivec2 size=textureSize(a,0);vec4 particle=texelFetch(a,ivec2(gl_VertexID%size.x,gl_VertexID/size.x),0);
        if(particle.w<=0.){gl_Position=vec4(3,3,3,1);gl_PointSize=1.;opticalWeight=0.;return;}
        opticalAbsorption=absorption;
        vec3 position=particle.xyz;
        if(interpolation<1.){vec4 previous=texelFetch(b,ivec2(gl_VertexID%size.x,gl_VertexID/size.x),0);if(previous.w>0.){
          vec3 displacement=particle.xyz-previous.xyz,box=vec3(.08,.12,.08);
          if(boundaryMode==1)displacement-=box*floor(displacement/box+.5);
          position=previous.xyz+interpolation*displacement;
          if(boundaryMode==1)position=mod(position,box);
        }}
        float ca=cos(angle),sa=sin(angle);vec3 right=vec3(ca,0.,-sa),up=vec3(.12*sa,.9928,.12*ca);
        vec3 offset=position-vec3(.04,cameraCenter,.04);
        vec2 xy=vec2(dot(offset,right),dot(offset,up));xy/=cameraSpan*vec2(resolution.x/resolution.y,1.);
        gl_Position=vec4(xy*2.,0.,1.);
        float sigma=max(.00013,.90*cameraSpan/resolution.y);
        gl_PointSize=6.*sigma*resolution.y/cameraSpan;
        // Normalize the square support truncated at +/- three sigma.
        opticalWeight=particle.w/(6.2831853*sigma*sigma*.9946076968);
      }`;
    program('renderParticles',`in float opticalWeight;flat in vec3 opticalAbsorption;void main(){vec2 p=(gl_PointCoord-.5)*6.;outColor=vec4(opticalAbsorption*(opticalWeight*exp(-.5*dot(p,p))),0);}`,common,pointVertex);
    program('transmit',`uniform vec3 paper;void main(){vec3 optical=texture(a,uv).rgb;outColor=vec4(paper*exp(-optical),1.);}`);
  } catch(error) {console.error(error);fail('The simulation could not initialise: '+error.message);return;}
  function clear(f){gl.bindFramebuffer(gl.FRAMEBUFFER,f.fb);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);}
  function allocate(mode){
    for(const f of fields){gl.deleteTexture(f.tex);gl.deleteFramebuffer(f.fb);}fields=[];levels=[];reductions=[];
    invalidateRenderState();
    const debugN=Number(new URLSearchParams(location.search).get('grid'));
    const nx=debugN>=16&&debugN<=192&&debugN%8===0?debugN:mode==='fine'?160:112;
    DT=Math.min(.01,.10*(.08/nx)**2/1e-6);
    dims=grid(nx,nx*1.5,nx);h=dims.h;
    velocity=pair(dims,4);forwardV=field(dims,4);forwardC=field(dims,4);buoyancy=pair(dims);
    scalarGroups=Array.from({length:Math.ceil(inks.length/4)},(_,index)=>({index,dye:pair(dims,4),means:[0,0,0,0],baseMasses:[0,0,0,0]}));
    opticalField=null;opticalScratch=null;tracerSets=[];
    if(particleRendering)particleSide=mode==='fine'?160:128;
    speed=field(dims);let rw=speed.width,rh=speed.height;
    while(rw>1||rh>1){rw=Math.ceil(rw/2);rh=Math.ceil(rh/2);reductions.push(field({n:[rw,rh,1],columns:1,h:1},4));}
    // Retain whole-cell coarsening in all three directions. Stopping after
    // three levels left Fine's long-wavelength pressure errors poorly resolved.
    let active=[nx,nx*1.5,nx];
    while(true){const g=grid(...active),geometry=field(g,4);g.geometry=geometry;levels.push({g,geometry,p:pair(g),rhs:field(g),res:field(g)});
      if(active.some(size=>size%2!==0)||Math.min(...active)/2<7)break;
      active=active.map(size=>size/2);
    }
    dims.geometry=levels[0].geometry;
    reset();
    if($('resolution'))$('resolution').textContent=`${nx} × ${nx*1.5} × ${nx} cells · ${(h*1000).toFixed(2)} mm`;
  }
  function smooth(level,count){for(let j=0;j<count;j++){draw('jacobi',level.p[1],{a:level.p[0],b:level.rhs});level.p.swap();}}
  function sumField(source){let result=source,start=0;while(start+1<reductions.length&&reductions[start+1].width>=Math.ceil(source.width/2)&&reductions[start+1].height>=Math.ceil(source.height/2))start++;for(let j=start;j<reductions.length;j++){const f=reductions[j];draw('reduceSum',f,{a:result});result=f;}return result;}
  function readReduced(source){gl.bindFramebuffer(gl.FRAMEBUFFER,source.fb);const value=new Float32Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,value);return value[0];}
  function centerRhs(level){const total=sumField(level.rhs);draw('centerRhs',level.res,{a:level.rhs,b:total});[level.rhs,level.res]=[level.res,level.rhs];}
  function fieldRms(source){draw('square',speed,{a:source});return Math.sqrt(readReduced(sumField(speed))/dims.fluidCount);}
  function vcycle(l){
    const level=levels[l];
    if(l===levels.length-1){smooth(level,28);return;}
    smooth(level,3);
    draw('residual',level.res,{a:level.p[0],b:level.rhs});
    const coarse=levels[l+1];draw('restrict',coarse.rhs,{a:level.res},{sourceN:level.g.n,sourceColumns:level.g.columns});centerRhs(coarse);clear(coarse.p[0]);
    vcycle(l+1);
    draw('prolong',level.p[1],{a:level.p[0],b:coarse.p[0],sourceGeometry:coarse.geometry},{sourceN:coarse.g.n,sourceColumns:coarse.g.columns});level.p.swap();
    smooth(level,3);
  }
  function projectVelocity(initial=false){
    const level=levels[0];draw('divergence',level.rhs,{a:velocity[0]});centerRhs(level);
    // Both Laplacians have a constant nullspace. Remove incompatible roundoff
    // from each multigrid RHS and choose one pressure reference after the solve.
    if(initial){
      const before=fieldRms(level.rhs),tolerance=Math.max(1e-6,before*1e-5);
      let previousResidual=Infinity;
      if(before>tolerance)for(let batch=0;batch<32;batch++){
        for(let cycle=0;cycle<4;cycle++)vcycle(0);
        draw('residual',level.res,{a:level.p[0],b:level.rhs});const residual=fieldRms(level.res);
        // Near the target, a float32 pressure field can stop improving. A small
        // correction solve below removes that cancellation error more accurately.
        if(residual<=tolerance||(batch>=2&&residual<=2*tolerance&&residual>=previousResidual*.98))break;
        previousResidual=residual;
      }
    }else{vcycle(0);vcycle(0);if(boundary==='container'&&containerShape!=='cuboid')vcycle(0);}
    draw('pressureGauge',level.p[1],{a:level.p[0]});level.p.swap();
    draw('project',velocity[1],{a:velocity[0],b:level.p[0]});velocity.swap();
    if(initial){
      // The initial wall-enforcement impulse is not the next timestep's pressure.
      // Refine its small residual from zero, then discard both initial guesses.
      level.p.forEach(clear);
      draw('divergence',level.rhs,{a:velocity[0]});centerRhs(level);
      if(fieldRms(level.rhs)>1e-6){vcycle(0);vcycle(0);draw('project',velocity[1],{a:velocity[0],b:level.p[0]});velocity.swap();}
      level.p.forEach(clear);
    }
  }
  function advance(){
    clear(buoyancy[0]);
    for(const group of scalarGroups){
      const coefficients=Array.from({length:4},(_,channel)=>(inks[group.index*4+channel]?.density||0)/100);
      draw('sumBuoyancy',buoyancy[1],{a:buoyancy[0],b:group.dye[0]},{coefficients,meanValues:group.means});buoyancy.swap();
    }
    draw('advectV',forwardV,{a:velocity[0]});
    draw('correctV',velocity[1],{a:velocity[0],b:forwardV,c:buoyancy[0]});velocity.swap();
    projectVelocity();
    draw('speed',speed,{a:velocity[0]});let reducedSpeed=speed;
    for(const f of reductions){draw('reduce',f,{a:reducedSpeed});reducedSpeed=f;}
    gl.bindFramebuffer(gl.FRAMEBUFFER,reducedSpeed.fb);const rate=new Float32Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,rate);
    const substeps=Math.max(1,Math.ceil(DT*rate[0]/h/.45));
    for(let s=0;s<substeps;s++)for(const group of scalarGroups){
      draw('transportC',forwardC,{a:velocity[0],b:group.dye[0],c:group.dye[0]},{rkStage:0,dt:DT/substeps});
      draw('transportC',group.dye[1],{a:velocity[0],b:forwardC,c:group.dye[0]},{rkStage:1,dt:DT/substeps});group.dye.swap();
    }
    simTime+=DT;stepIndex++;
    for(const set of tracerSets){draw('advectParticles',set.particles[1],{a:velocity[0],b:set.particles[0],ids:set.ids},{n:dims.n,columns:dims.columns,h,stepIndex,inkKey:set.id-1});set.particles.swap();}
  }
  function seedCompactParticles(){
    for(const set of tracerSets){set.particles.forEach(discardField);discardField(set.ids);}tracerSets=[];
    // Seed with the original GPU quadrature, then retain every positive sample
    // unchanged. This one-time transfer removes only samples that contain no ink.
    const candidates=field({n:[1024,Math.ceil(particleSide**3/1024),1],columns:1,h},4);
    for(let index=0;index<inks.length;index++){
      const ink=inks[index],initialShape=initialShapeForInk(ink.id);
      draw('seedParticles',candidates,{},{particleSide,h,inkKey:ink.id-1,dropCentre:dropCentres[index],shapePhase:initialShape.phases,shapeOrientation:initialShape.orientation});
      const raw=read(candidates);let count=0;for(let i=3;i<raw.length;i+=4)if(raw[i]>0)count++;
      const g={n:[1024,Math.max(1,Math.ceil(count/1024)),1],columns:1,h};
      const packed=new Float32Array(g.n[0]*g.n[1]*4),ids=new Float32Array(g.n[0]*g.n[1]);
      for(let i=0,j=0;i<raw.length;i+=4)if(raw[i+3]>0){const k=j*4;packed[k]=raw[i];packed[k+1]=raw[i+1];packed[k+2]=raw[i+2];packed[k+3]=raw[i+3];ids[j]=i/4;j++;}
      const set={id:ink.id,particles:pair(g,4),ids:field(g),count};
      gl.bindTexture(gl.TEXTURE_2D,set.particles[0].tex);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,g.n[0],g.n[1],gl.RGBA,gl.FLOAT,packed);
      gl.bindTexture(gl.TEXTURE_2D,set.ids.tex);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,g.n[0],g.n[1],gl.RED,gl.FLOAT,ids);
      renderState.activeUnit=-1;renderState.textures=[];tracerSets.push(set);
    }
    discardField(candidates);
  }
  function reset(){
    manualSteps=0;
    fields.forEach(clear);simTime=0;stepIndex=0;accumulator=0;
    for(let i=0;i<levels.length;i++){
      const level=levels[i];
      if(i===0)draw('makeGeometry',level.geometry);else{const fine=levels[i-1];draw('coarsenGeometry',level.geometry,{a:fine.geometry},{sourceN:fine.g.n,sourceColumns:fine.g.columns});}
      if(boundary==='periodic'||containerShape==='cuboid')level.g.fluidCount=level.g.active.reduce((a,b)=>a*b,1);
      else{draw('fluidVolume',level.res);level.g.fluidCount=readReduced(sumField(level.res));clear(level.res);}
    }
    dims.fluidCount=levels[0].g.fluidCount;
    dropCentres=chooseDropCentres();
    for(const group of scalarGroups){
      const activeSpecies=Array.from({length:4},(_,channel)=>group.index*4+channel<inks.length?1:0),centres={};
      for(let channel=0;channel<4;channel++){
        const index=group.index*4+channel,initialShape=initialShapeForInk(inks[index]?.id||1);
        centres['centre'+channel]=dropCentres[index]||[0,0,0];
        centres['phases'+channel]=initialShape.phases;centres['orientation'+channel]=initialShape.orientation;
      }
      draw('seed',group.dye[0],{},{...centres,activeSpecies});
      for(let channel=0;channel<4;channel++){
        draw('activeValue',speed,{a:group.dye[0]},{channel});const sum=readReduced(sumField(speed));
        group.means[channel]=sum/dims.fluidCount;group.baseMasses[channel]=sum*h**3;
      }
      draw('scalarGhosts',group.dye[1],{a:group.dye[0]});group.dye.swap();
    }
    draw('seedAmbient',velocity[0],{},{currentAmplitude:.004*currentStrength});
    // First impose the selected velocity boundary with zero pressure. In a
    // container this changes boundary fluxes, so a genuine initial projection follows.
    draw('project',velocity[1],{a:velocity[0],b:levels[0].p[0]});velocity.swap();
    projectVelocity(true);
    if(particleRendering)seedCompactParticles();
    updateUI();render();
  }
  function updateUI(){
    if($('toggle')){ $('toggle').textContent=running?'Pause':'Play';$('toggle').setAttribute('aria-label',running?'Pause simulation':'Play simulation');}
    if($('step'))$('step').disabled=running||manualSteps>0;
    const status=running?'Running':'Paused';
    if($('sim-status')&&$('sim-status').textContent!==status)$('sim-status').textContent=status;
    const ink=selectedInk();
    if($('density-value'))$('density-value').textContent=ink.density.toFixed(2)+'%';
    if($('density'))$('density').value=ink.density;
    if($('ink-colour'))$('ink-colour').value=ink.colour;
    if($('ink-hex')&&document.activeElement!==$('ink-hex'))$('ink-hex').value=ink.colour;
    const selector=$('ink-select');
    if(selector){
      if(selector.options.length!==inks.length||Array.from(selector.options).some((option,index)=>option.dataset.inkId!==String(inks[index]?.id))){
        selector.replaceChildren(...inks.map((item,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent='Ink '+(index+1);option.dataset.inkId=String(item.id);return option;}));
      }
      selector.value=String(activeInkIndex);
    }
    if($('add-ink')){$('add-ink').disabled=inks.length>=MAX_INKS;$('add-ink').setAttribute('aria-label',inks.length>=MAX_INKS?'Maximum of '+MAX_INKS+' inks':'Add an ink');}
    if($('remove-ink'))$('remove-ink').disabled=inks.length===1;
    if($('domain'))$('domain').value=domainValue();
    if($('speed-value'))$('speed-value').textContent=Number(playbackSpeed.toFixed(2))+'×';
    if($('current-strength-value'))$('current-strength-value').textContent=Number(currentStrength.toFixed(2))+'×';
    $('speed')?.setAttribute('aria-valuetext',playbackSpeed+' times');
    $('current-strength')?.setAttribute('aria-valuetext',currentStrength===0?'Still water':currentStrength+' times initial current strength');
    $('density')?.setAttribute('aria-valuetext',ink.density===0?'Same density as water':Math.abs(ink.density).toFixed(2)+' percent '+(ink.density>0?'denser':'less dense')+' than water');
    if($('angle-value'))$('angle-value').textContent=Math.round(angle*180/Math.PI)+'°';
  }
  function render(interpolation=1){
    if(!velocity)return;
    const box=canvas.getBoundingClientRect();const dpr=Math.min(devicePixelRatio||1,1.5);
    const w=Math.max(1,Math.round(box.width*dpr)),hh=Math.max(1,Math.round(box.height*dpr));
    if(canvas.width!==w||canvas.height!==hh){canvas.width=w;canvas.height=hh;}
    // Fit the whole volume at every azimuth. Never follow or refit to the ink.
    const shape=boundary==='periodic'?'cuboid':containerShape;
    const spanX=shape==='cuboid'?.08*Math.SQRT2+.008:.088;
    const spanY=shape==='sphere'?.088:.12*.9928+.12*(shape==='cuboid'?.08*Math.SQRT2:.08)+.008;
    cameraSpan=Math.max(spanY,spanX/(w/hh));
    window.updateInkBoundaryView?.({boundary,containerShape,shape:containerShape,angle,cameraCenter,cameraSpan,width:box.width,height:box.height});
    const optical={resolution:[w,hh],angle,cameraCenter,cameraSpan,interpolation:Math.max(0,Math.min(1,interpolation)),paper:[.9804,.9765,.9647]};
    if(!opticalField||opticalField.width!==w||opticalField.height!==hh){
      discardField(opticalField);discardField(opticalScratch);opticalScratch=null;
      const g={n:[w,hh,1],columns:1,h:1};opticalField=field(g,4);
      if(!particleRendering)opticalScratch=field(g,4);
    }
    clear(opticalField);
    if(particleRendering){
      gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);
      for(let index=0;index<tracerSets.length;index++){
        const set=tracerSets[index];draw('renderParticles',opticalField,{a:set.particles[0],b:set.particles[1]},{...optical,absorption:absorptionFor(inks[index].colour)},gl.POINTS,set.count);
      }
      gl.disable(gl.BLEND);
    }else for(const group of scalarGroups){
      const coefficients={};for(let channel=0;channel<4;channel++)coefficients['absorption'+channel]=inks[group.index*4+channel]?absorptionFor(inks[group.index*4+channel].colour):[0,0,0];
      draw('render',opticalScratch,{a:group.dye[0],b:opticalField},{...optical,...coefficients,n:dims.n,columns:dims.columns,h});
      [opticalField,opticalScratch]=[opticalScratch,opticalField];
    }
    draw('transmit',null,{a:opticalField},optical);
  }
  function frame(now){
    if(destroyed)return;raf=requestAnimationFrame(frame);
    if(!visible||document.hidden){lastFrame=now;return;}
    const elapsed=lastFrame?Math.min((now-lastFrame)/1000,.1):0;lastFrame=now;
    if(running)accumulator=Math.min(accumulator+elapsed*playbackSpeed,DT*8);
    const started=performance.now(),frameBudget=Math.min(28,12*Math.max(1,playbackSpeed));let steps=0;
    // Playback changes the number of fixed steps, never their physical duration.
    // Bound the work per frame to keep interaction and rendering responsive.
    while((manualSteps>0||(running&&accumulator>=DT))&&steps<8){
      advance();steps++;
      if(manualSteps>0)manualSteps--;else accumulator-=DT;
      if(performance.now()-started>=frameBudget)break;
    }
    // Discard a backlog when the GPU cannot maintain the requested playback rate.
    // Interpolation remains between the two most recent physical states.
    if(running&&accumulator>DT)accumulator=DT;
    if(steps){updateUI();if(!running)render();}
    if(running)render(simTime>0?accumulator/DT:1);
  }
  function renderPlayback(){render(running&&simTime>0?accumulator/DT:1);}
  function settingsSnapshot(){
    return {modelVersion:5,inks:inks.map(ink=>({...ink})),activeInkIndex,maxInks:MAX_INKS,domain:domainValue(),viewAngleDegrees:Math.round(angle*180/Math.PI),seed:experimentSeed,playbackSpeed,boundary,containerShape,currentStrength,initialMotion,quality,dt:DT,secondInk:inks.length>1,density:inks[0].density,density2:inks[1]?.density||0};
  }
  function save(){
    if(window.openai?.setWidgetState)window.openai.setWidgetState({modelContent:settingsSnapshot(),privateContent:{running}}).catch(()=>{});
  }
  function clearColourError(){const input=$('ink-hex');if(input){input.setCustomValidity('');input.removeAttribute('aria-invalid');input.value=selectedInk().colour;}}
  function setColour(value){
    const colour=normaliseHex(value);if(!colour)return false;
    selectedInk().colour=colour;clearColourError();updateUI();renderPlayback();save();return true;
  }
  function setDomain(value){boundary=value==='periodic'?'periodic':'container';if(['cuboid','cylinder','sphere'].includes(value))containerShape=value;}
  function replaceInks(next,index=0){
    const previous=inks,previousIndex=activeInkIndex;inks=next;activeInkIndex=Math.max(0,Math.min(index,inks.length-1));
    try{allocate(quality);clearColourError();if($('sim-error'))$('sim-error').hidden=true;return true;}
    catch(error){
      console.error(error);inks=previous;activeInkIndex=previousIndex;
      try{allocate(quality);if($('sim-error')){$('sim-error').hidden=false;$('sim-error').textContent='This graphics device could not allocate that many inks at this resolution. The previous setup has been restored.';}}
      catch(recoveryError){console.error(recoveryError);fail('The graphics device ran out of resources. Reload the page to restart.');}
      return false;
    }
  }
  function restore(snapshot){const s=snapshot?.modelContent;if(!s||![3,4,5].includes(s.modelVersion))return;
    let restart=false,reallocate=false;
    let incoming;
    if(s.modelVersion===5&&Array.isArray(s.inks)&&s.inks.length){
      const used=new Set();let candidate=1;
      incoming=s.inks.slice(0,MAX_INKS).map(value=>{
        const record=value&&typeof value==='object'?value:{};
        let id=record.id;if(!Number.isInteger(id)||id<1||id>2147483646||used.has(id)){while(used.has(candidate))candidate++;id=candidate++;}used.add(id);
        return{id,density:Number.isFinite(record.density)?Math.max(-.4,Math.min(1.2,record.density)):.04,colour:normaliseHex(record.colour)||DEFAULT_COLOUR};
      });
    }else if(s.modelVersion<5){
      const legacy=(id,density,colour,fallback)=>({id,density:Number.isFinite(density)?Math.max(-.4,Math.min(1.2,density)):fallback,colour:Object.hasOwn(palette,colour)?hexForAbsorption(palette[colour]):id===1?DEFAULT_COLOUR:hexForAbsorption(palette.amber)});
      incoming=[legacy(1,s.densityContrastPercent,s.inkColour,.04)];
      if(s.secondInk)incoming.push(legacy(2,s.densityContrastPercent2,s.inkColour2,.08));
    }
    if(incoming){reallocate=incoming.length!==inks.length||incoming.some((ink,index)=>ink.id!==inks[index]?.id);inks=incoming;nextInkId=Math.max(...inks.map(ink=>ink.id))+1;}
    if(Number.isInteger(s.activeInkIndex))activeInkIndex=Math.max(0,Math.min(inks.length-1,s.activeInkIndex));else activeInkIndex=Math.min(activeInkIndex,inks.length-1);
    if(Number.isFinite(s.viewAngleDegrees)){angle=Math.max(-180,Math.min(180,s.viewAngleDegrees))*Math.PI/180;if($('angle'))$('angle').value=s.viewAngleDegrees;}
    if(Number.isInteger(s.seed)&&s.seed>=0&&s.seed<=4294967295&&s.seed!==experimentSeed){chooseSeed(s.seed);restart=true;}
    if(Number.isFinite(s.playbackSpeed)){playbackSpeed=Math.max(.25,Math.min(6,s.playbackSpeed));if($('speed'))$('speed').value=playbackSpeed;}
    const requestedDomain=['cuboid','cylinder','sphere','periodic'].includes(s.domain)?s.domain:s.boundary==='periodic'?'periodic':['cuboid','cylinder','sphere'].includes(s.containerShape)?s.containerShape:null;
    if(requestedDomain&&requestedDomain!==domainValue()){setDomain(requestedDomain);restart=true;}
    if(Number.isFinite(s.currentStrength)||s.initialMotion){
      const restoredCurrent=Number.isFinite(s.currentStrength)?Math.max(0,Math.min(3,s.currentStrength)):s.initialMotion==='still'?0:1;
      if(restoredCurrent!==currentStrength){currentStrength=restoredCurrent;initialMotion=currentStrength>0?'gentle':'still';restart=true;if($('current-strength'))$('current-strength').value=currentStrength;}
    }
    if(['standard','fine'].includes(s.quality)&&s.quality!==quality){quality=s.quality;reallocate=true;if($('quality'))$('quality').value=quality;}
    if(reallocate)allocate(quality);else if(restart)reset();
    if(typeof snapshot.privateContent?.running==='boolean'){const resume=snapshot.privateContent.running&&!reduced.matches;if(resume&&!running)accumulator=DT;running=resume;}
    clearColourError();updateUI();renderPlayback();
  }
  try {
    allocate(quality);restore(window.openai?.widgetState);
    if($('loading'))$('loading').hidden=true;
    if($('ink-stage'))$('ink-stage').setAttribute('aria-busy','false');
    $('toggle')?.addEventListener('click',()=>{running=!running;manualSteps=0;accumulator=running?DT:0;updateUI();renderPlayback();save();});
    $('step')?.addEventListener('click',()=>{if(!running){manualSteps=Math.round(.1/DT);updateUI();}});
    $('reset')?.addEventListener('click',()=>{reset();save();});
    $('speed')?.addEventListener('input',e=>{playbackSpeed=Number(e.target.value);updateUI();save();});
    $('seed')?.addEventListener('change',e=>{
      const value=e.target.valueAsNumber;
      if(Number.isInteger(value)&&value>=0&&value<=4294967295){chooseSeed(value);reset();save();}
      else e.target.value=String(experimentSeed);
    });
    $('random-seed')?.addEventListener('click',()=>{let value=freshSeed();while(value===experimentSeed)value=freshSeed();chooseSeed(value);reset();save();});
    $('density')?.addEventListener('input',e=>{selectedInk().density=Math.max(-.4,Math.min(1.2,Number(e.target.value)));updateUI();save();});
    $('ink-select')?.addEventListener('change',e=>{activeInkIndex=Math.max(0,Math.min(inks.length-1,Number(e.target.value)));clearColourError();updateUI();save();});
    $('add-ink')?.addEventListener('click',()=>{
      if(inks.length>=MAX_INKS)return;
      const colours=['#c18c2f','#4c9b73','#aa4267','#8061bf','#397d9c'];
      const ink={id:nextInkId++,density:.04,colour:colours[(inks.length-1)%colours.length]};
      if(replaceInks([...inks,ink],inks.length))save();
    });
    $('remove-ink')?.addEventListener('click',()=>{if(inks.length>1&&replaceInks(inks.filter((_,index)=>index!==activeInkIndex),Math.min(activeInkIndex,inks.length-2)))save();});
    $('ink-colour')?.addEventListener('input',e=>setColour(e.target.value));
    $('ink-hex')?.addEventListener('input',e=>{if(normaliseHex(e.target.value)){e.target.setCustomValidity('');e.target.removeAttribute('aria-invalid');}});
    $('ink-hex')?.addEventListener('change',e=>{if(!setColour(e.target.value)){e.target.setCustomValidity('Enter a six-digit hexadecimal colour, for example #3657b2.');e.target.setAttribute('aria-invalid','true');e.target.reportValidity();}});
    $('ink-hex')?.addEventListener('blur',e=>{if(!normaliseHex(e.target.value))clearColourError();});
    $('ink-hex')?.addEventListener('keydown',e=>{if(e.key==='Escape'){clearColourError();e.preventDefault();}else if(e.key==='Enter'){e.preventDefault();e.target.dispatchEvent(new Event('change'));}});
    $('angle')?.addEventListener('input',e=>{angle=Number(e.target.value)*Math.PI/180;renderPlayback();updateUI();save();});
    $('quality')?.addEventListener('change',e=>{const previous=quality;quality=e.target.value;try{allocate(quality);if($('sim-error'))$('sim-error').hidden=true;save();}catch(error){quality=previous;e.target.value=quality;try{allocate(quality);if($('sim-error')){$('sim-error').hidden=false;$('sim-error').textContent='This graphics device could not allocate Fine resolution with the selected inks. The previous resolution has been restored.';}}catch(recoveryError){fail('The graphics device ran out of resources. Reload the page to restart.');}}});
    $('initial-motion')?.addEventListener('change',e=>{initialMotion=e.target.value;currentStrength=initialMotion==='still'?0:1;reset();save();});
    $('current-strength')?.addEventListener('input',e=>{currentStrength=Math.max(0,Math.min(3,Number(e.target.value)));initialMotion=currentStrength>0?'gentle':'still';updateUI();});
    $('current-strength')?.addEventListener('change',()=>{reset();save();});
    $('domain')?.addEventListener('change',e=>{setDomain(e.target.value);reset();save();});
    reduced.addEventListener('change',e=>{if(e.matches){running=false;manualSteps=0;updateUI();render();}});
    window.addEventListener('openai:set_globals',e=>restore(e.detail?.globals?.widgetState));
    new ResizeObserver(()=>renderPlayback()).observe(canvas);
    new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;}).observe(canvas);
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();destroyed=true;cancelAnimationFrame(raf);fail('The graphics context was interrupted. Reload the page to restart the simulation.');});
    raf=requestAnimationFrame(frame);
  }catch(error){console.error(error);fail(error.message);}
  // Read-only field diagnostics plus deterministic stepping for numerical QA.
  function read(f){gl.bindFramebuffer(gl.FRAMEBUFFER,f.fb);const data=new Float32Array(f.width*f.height*4);gl.readPixels(0,0,f.width,f.height,gl.RGBA,gl.FLOAT,data);return data;}
  function values(f,channel=0){const raw=read(f),result=[];const [nx,ny,nz]=f.g.n;const ghost=f.g.active?1:0;for(let z=ghost;z<nz-ghost;z++)for(let y=ghost;y<ny-ghost;y++)for(let x=ghost;x<nx-ghost;x++){const index=((Math.floor(z/f.g.columns)*ny+y)*f.width+(z%f.g.columns)*nx+x)*4;result.push(raw[index+channel]);}return result;}
  window.InkSimulation={
    invalidateRenderState,
    pause(){running=false;manualSteps=0;updateUI();render();},play(){if(!running)accumulator=DT;running=true;updateUI();renderPlayback();},
    step(count=1){for(let i=0;i<count;i++)advance();render();updateUI();},reset,
    restoreSettings(settings){restore({modelContent:{modelVersion:5,...settings}});return settingsSnapshot();},
    get settings(){return settingsSnapshot();},
    get time(){return simTime;},get grid(){return dims.active.slice();},
    get configuration(){return{boundary,containerShape,currentStrength,initialMotion,meanConcentration:scalarGroups[0].means[0],meanConcentration2:scalarGroups[0].means[1],perInk:inks.map((ink,index)=>({id:ink.id,meanConcentration:scalarGroups[Math.floor(index/4)].means[index%4],centre:dropCentres[index].slice(),initialShape:initialShapeForInk(ink.id),absorption:absorptionFor(ink.colour)})),fluidCells:dims.fluidCount};},
    get camera(){return {center:cameraCenter,span:cameraSpan};},
    tracerDiagnostics(){
      if(!particleRendering)return{available:false,perInk:[]};
      const perInk=tracerSets.map(set=>{
        const raw=read(set.particles[0]);let amount=0,count=0,escaped=0,escapedAmount=0,outsideActive=0,finite=true;
        for(let i=0;i<raw.length;i+=4){const w=raw[i+3];if(w===0)continue;finite&&=Number.isFinite(w)&&Number.isFinite(raw[i])&&Number.isFinite(raw[i+1])&&Number.isFinite(raw[i+2]);if(w<0){escaped++;escapedAmount-=w;continue;}amount+=w;count++;if(raw[i]<0||raw[i]>.080001||raw[i+1]<0||raw[i+1]>.120001||raw[i+2]<0||raw[i+2]>.080001)outsideActive++;}
        return{id:set.id,amount,count,escaped,escapedAmount,totalAmount:amount+escapedAmount,outsideActive,finite};
      });
      const result={available:true,amount:0,count:0,escaped:0,escapedAmount:0,totalAmount:0,outsideActive:0,finite:true,perInk};
      for(const item of perInk){for(const key of ['amount','count','escaped','escapedAmount','totalAmount','outsideActive'])result[key]+=item[key];result.finite&&=item.finite;}
      render();return result;
    },
    diagnostics(){
      const perInk=inks.map((ink,index)=>({id:ink.id,index,mass:0,min:Infinity,max:-Infinity,finite:true,relativeMass:1}));
      const [nx,ny,nz]=dims.n;
      for(const group of scalarGroups){
        const raw=read(group.dye[0]),f=group.dye[0];
        for(let z=1;z<nz-1;z++)for(let y=1;y<ny-1;y++)for(let x=1;x<nx-1;x++){
          const offset=((Math.floor(z/dims.columns)*ny+y)*f.width+(z%dims.columns)*nx+x)*4;
          for(let channel=0;channel<4;channel++){
            const item=perInk[group.index*4+channel];if(!item)break;
            const value=raw[offset+channel];item.mass+=value;item.min=Math.min(item.min,value);item.max=Math.max(item.max,value);item.finite&&=Number.isFinite(value);
          }
        }
        for(let channel=0;channel<4;channel++){const item=perInk[group.index*4+channel];if(!item)break;item.mass*=h**3;item.relativeMass=group.baseMasses[channel]>0?item.mass/group.baseMasses[channel]:1;}
      }
      const mass=perInk.reduce((sum,item)=>sum+item.mass,0),baseMass=scalarGroups.reduce((sum,group)=>sum+group.baseMasses.reduce((a,b)=>a+b,0),0);
      let min=Math.min(...perInk.map(item=>item.min)),max=Math.max(...perInk.map(item=>item.max)),finite=perInk.every(item=>item.finite);
      draw('divergence',levels[0].res,{a:velocity[0]});const after=values(levels[0].res),before=values(levels[0].rhs);
      const rms=v=>Math.sqrt(v.reduce((sum,x)=>sum+x*x,0)/v.length);
      const v=read(velocity[0]);let maxSpeed=0;for(let i=0;i<v.length;i+=4){maxSpeed=Math.max(maxSpeed,Math.hypot(v[i],v[i+1],v[i+2]));finite&&=Number.isFinite(v[i]+v[i+1]+v[i+2]);}
      const result={time:simTime,grid:dims.active,min,max,mass,mass1:perInk[0].mass,mass2:perInk[1]?.mass||0,escapedMass:0,relativeMass:baseMass>0?mass/baseMass:1,massBalance:baseMass>0?mass/baseMass:1,finite,maxSpeed,divergenceBefore:rms(before),divergenceAfter:rms(after),perInk,glError:gl.getError()};render();return result;
    }
  };
})();
