// Curved containers exercise the production finite-volume mask, pressure
// projection, conservative scalar flux, and reflected tracer trajectories.
const fs=require('node:fs');const assert=require('node:assert/strict');const{chromium}=require('playwright');
const source=fs.readFileSync(process.env.INK_SOURCE||'ink.js','utf8');
const hook=String.raw`qaGeometry(shape,mode='container',strength=1){running=false;containerShape=shape;boundary=mode;currentStrength=strength;initialMotion=strength?'gentle':'still';density=1.2;chooseSeed(125);reset();},
qaGeometryGradient(){
 levels.forEach(l=>{l.p.forEach(clear);clear(l.rhs);clear(l.res);});
 if(!programs.qaGeometryGradient)program('qaGeometryGradient',\`float phi(ivec3 q){vec3 p=(vec3(q)-.5)*h;return .000003*cos(31.*p.x)*sin(41.*p.y)*cos(29.*p.z);}
 void main(){ivec3 q=cell();if(q.z>=int(n.z)){outColor=vec4(0);return;}vec3 v=vec3(0);for(int axis=0;axis<3;axis++){ivec3 e=ivec3(0);e[axis]=1;ivec3 p=faceCell(q,axis);v[axis]=(phi(p+e)-phi(p))/h;}outColor=vec4(wallVelocity(v,q),0);}\`);
 draw('qaGeometryGradient',velocity[0]);projectVelocity(true);render();
},
qaGeometryStats(){
 const mask=read(levels[0].geometry),v=read(velocity[0]),c=read(dye[0]),N=dims.active,[nx,ny]=dims.n,columns=dims.columns,width=velocity[0].width;
 const offset=q=>((Math.floor(q[2]/columns)*ny+q[1])*width+(q[2]%columns)*nx+q[0])*4;
 const inside=q=>q.every((x,j)=>x>=1&&x<=N[j]);
 const fluid=q=>inside(q)&&mask[offset(q)+3]>.5;
 let wallFlux=0,solidDye=0,fluidCells=0,maximumFluidSpeed=0,blockedFaces=0;
 for(let z=0;z<=N[2];z++)for(let y=0;y<=N[1];y++)for(let x=0;x<=N[0];x++){
  const q=[x,y,z],i=offset(q),wet=fluid(q);if(wet)fluidCells++;else if(inside(q))solidDye=Math.max(solidDye,Math.abs(c[i]));
  for(let axis=0;axis<3;axis++){const next=q.slice();next[axis]++;const neighbour=fluid(next);if(wet!==neighbour){blockedFaces++;wallFlux=Math.max(wallFlux,Math.abs(v[i+axis]));}if(wet&&neighbour)maximumFluidSpeed=Math.max(maximumFluidSpeed,Math.abs(v[i+axis]));}
 }
 let outsideVoxels=0,outsideAnalytic=0,tracers=0,tracerMass=0,outsideExamples=[];
 if(particleRendering){const p=read(particles[0]);for(let i=0;i<p.length;i+=4)if(p[i+3]>0){tracers++;tracerMass+=p[i+3];const q=[0,1,2].map(j=>Math.floor(p[i+j]/h)+1);if(!fluid(q)){outsideVoxels++;if(outsideExamples.length<8)outsideExamples.push({q,p:Array.from(p.slice(i,i+3)),weight:p[i+3]});}
  const dx=p[i]-.04,dy=p[i+1]-.06,dz=p[i+2]-.04;if(containerShape==='sphere'?dx*dx+dy*dy+dz*dz>.001600001:containerShape==='cylinder'?dx*dx+dz*dz>.001600001||Math.abs(dy)>.060001:p[i]<0||p[i]>.080001||p[i+1]<0||p[i+1]>.120001||p[i+2]<0||p[i+2]>.080001)outsideAnalytic++;
 }}
 render();return{wallFlux,solidDye,fluidCells,blockedFaces,maximumFluidSpeed,outsideVoxels,outsideAnalytic,outsideExamples,tracers,tracerMass,hierarchy:levels.map(l=>({grid:l.g.active,fluidVolume:l.g.fluidCount}))};
},`;
const instrumented=source.replace('window.InkSimulation={','window.InkSimulation={'+hook.replaceAll('\\`','`'));new Function(instrumented);
(async()=>{const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11']});try{
 const page=await browser.newPage({viewport:{width:900,height:950}});await page.emulateMedia({reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/ink.js',route=>route.fulfill({body:instrumented,contentType:'application/javascript'}));await page.goto('http://127.0.0.1:8765/?grid='+ (process.env.GEOMETRY_GRID||32));assert(await page.evaluate(()=>!!window.InkSimulation));
 const report={grid:await page.evaluate(()=>InkSimulation.grid),shapes:{}};
 for(const shape of ['cylinder','sphere']){
  await page.evaluate(shape=>InkSimulation.qaGeometry(shape),shape);const initial=await page.evaluate(()=>({flow:InkSimulation.diagnostics(),geometry:InkSimulation.qaGeometryStats()}));
  assert(initial.flow.finite&&initial.flow.divergenceAfter<2e-5,shape+' initial projection');
  assert.equal(initial.geometry.outsideVoxels,0);assert.equal(initial.geometry.outsideAnalytic,0);assert.equal(initial.geometry.wallFlux,0);assert.equal(initial.geometry.solidDye,0);
  for(let batch=0;batch<Number(process.env.GEOMETRY_SECONDS||30);batch++){await page.evaluate(()=>InkSimulation.step(100));if(batch%10===9)console.log(shape+' '+(batch+1)+' seconds');}
  const after=await page.evaluate(()=>({flow:InkSimulation.diagnostics(),geometry:InkSimulation.qaGeometryStats()}));
  fs.writeFileSync('qa/geometry-latest-'+shape+'.json',JSON.stringify({initial,after},null,2));
  assert(after.flow.finite&&after.flow.min>=-1e-7&&after.flow.max<1.02&&after.flow.glError===0,shape+' bounded finite dye');
  assert(Math.abs(after.flow.mass/initial.flow.mass-1)<1e-5,shape+' conservative closed volume');assert(after.flow.divergenceAfter<3e-4,shape+' projected flow');
  assert.equal(after.geometry.wallFlux,0);assert.equal(after.geometry.solidDye,0);assert.equal(after.geometry.outsideVoxels,0);assert.equal(after.geometry.outsideAnalytic,0);assert.equal(after.geometry.tracers,initial.geometry.tracers);assert.equal(after.geometry.tracerMass,initial.geometry.tracerMass);
  await page.evaluate(()=>InkSimulation.qaGeometryGradient());const manufactured=await page.evaluate(()=>({flow:InkSimulation.diagnostics(),geometry:InkSimulation.qaGeometryStats()}));
  assert(manufactured.geometry.maximumFluidSpeed<2e-7,shape+' manufactured gradient projected away');assert(manufactured.flow.divergenceAfter<2e-5);assert.equal(manufactured.geometry.wallFlux,0);
  report.shapes[shape]={initial,after,manufactured};
 }
 // A selected curved shape must have no effect on periodic topology.
 const periodic=[];for(const shape of ['cuboid','sphere']){await page.evaluate(shape=>InkSimulation.qaGeometry(shape,'periodic'),shape);await page.evaluate(()=>InkSimulation.step(20));periodic.push(await page.evaluate(()=>InkSimulation.diagnostics()));}
 assert.deepEqual(periodic[0],periodic[1]);report.periodic=periodic[0];
 assert.deepEqual(errors,[]);report.errors=errors;fs.writeFileSync('qa/geometry-validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
