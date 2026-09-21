// Boundary-operator regressions against the production shaders. Hooks only seed
// manufactured fields and inspect results; they do not replace transport operators.
const fs=require('node:fs');const assert=require('node:assert/strict');const{chromium}=require('playwright');
const source=fs.readFileSync(process.env.INK_SOURCE||'ink.js','utf8');
const hook=String.raw`qaConfigure(mode){running=false;boundary=mode;initialMotion='still';currentStrength=0;density=1.2;if(typeof chooseSeed==='function')chooseSeed(12345);reset();},
qaManufactured(kind){
 levels.forEach(l=>{l.p.forEach(clear);clear(l.rhs);clear(l.res);});
 if(!programs.qaVelocity)program('qaVelocity',\`uniform int gradient;uniform vec3 referenceVelocity;
 float phi(ivec3 q){q=scalarCell(q);vec3 x=(vec3(q)-.5)/(n-2.);return .000003*(boundaryMode==1?sin(6.283185307*x.x)*cos(6.283185307*x.y)*sin(6.283185307*x.z):cos(3.141592654*x.x)*cos(3.141592654*x.y)*cos(3.141592654*x.z));}
 void main(){ivec3 q=cell();if(q.z>=int(n.z)){outColor=vec4(0);return;}vec3 v=referenceVelocity;for(int axis=0;axis<3;axis++){ivec3 p=faceCell(q,axis),e=ivec3(0);e[axis]=1;if(gradient==1)v[axis]+=(phi(p+e)-phi(p))/h;}outColor=vec4(wallVelocity(v,q),0);}\`);
 if(!programs.qaScalar)program('qaScalar',\`uniform int pattern;void main(){ivec3 q=cell();if(q.z>=int(n.z)){outColor=vec4(0);return;}q=scalarCell(q);float c=.25;if(pattern==1)c+=.1*sin(6.283185307*(float(q.x)-.5)/(n.x-2.));outColor=vec4(c,0,0,1);}\`);
 const reference=boundary==='periodic'?[.031,-.023,.019]:[0,0,0];
 draw('qaVelocity',velocity[0],{},{referenceVelocity:reference,gradient:kind==='gradient'?1:0});
 draw('qaScalar',dye[0],{},{pattern:kind==='pattern'?1:0});
 meanConcentration=.25;density=kind==='constant'?.8:0;baseMass=0;simTime=0;stepIndex=0;
 if(kind==='gradient')projectVelocity(true);render();return reference;
},
qaBoundaryStats(reference=[0,0,0]){
 const vr=read(velocity[0]),cr=read(dye[0]),N=dims.active,[nx,ny]=dims.n,columns=dims.columns,width=velocity[0].width;
 const offset=q=>((Math.floor(q[2]/columns)*ny+q[1])*width+(q[2]%columns)*nx+q[0])*4;
 const wrap=(q,j)=>((q[j]-1)%N[j]+N[j])%N[j]+1;
 let normalMax=0,ghostVelocityError=0,ghostScalarError=0,referenceError=0;
 for(let z=0;z<=N[2]+1;z++)for(let y=0;y<=N[1]+1;y++)for(let x=0;x<=N[0]+1;x++){
  const q=[x,y,z],i=offset(q),inside=q.every((v,j)=>v>=1&&v<=N[j]);
  if(inside)for(let j=0;j<3;j++)referenceError=Math.max(referenceError,Math.abs(vr[i+j]-reference[j]));
  else{const sc=q.map((v,j)=>boundary==='periodic'?wrap(q,j):Math.max(1,Math.min(N[j],v)));ghostScalarError=Math.max(ghostScalarError,Math.abs(cr[i]-cr[offset(sc)]));
   for(let axis=0;axis<3;axis++){const p=q.map((v,j)=>boundary==='periodic'?wrap(q,j):Math.max(j===axis?0:1,Math.min(N[j],v)));let expected=vr[offset(p)+axis];if(boundary==='container'&&(q[axis]<=0||q[axis]>=N[axis]))expected=0;ghostVelocityError=Math.max(ghostVelocityError,Math.abs(vr[i+axis]-expected));}}
  if(boundary==='container')for(let j=0;j<3;j++)if(q[j]===0||q[j]===N[j])normalMax=Math.max(normalMax,Math.abs(vr[i+j]));
 }
 render();return{normalMax,ghostVelocityError,ghostScalarError,referenceError};
},
qaMinimalImage(){
 if(!particleRendering)return{available:false};particleCount=1;
 gl.bindTexture(gl.TEXTURE_2D,particles[0].tex);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,1,1,gl.RGBA,gl.FLOAT,new Float32Array([.0001,.06,.04,1e-7]));
 gl.bindTexture(gl.TEXTURE_2D,particles[1].tex);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,1,1,gl.RGBA,gl.FLOAT,new Float32Array([.0799,.06,.04,1e-7]));
 invalidateRenderState();render(.5);gl.bindFramebuffer(gl.FRAMEBUFFER,null);const rgba=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,rgba);let sum=0,xsum=0;for(let i=0;i<rgba.length;i+=4){const darkness=Math.max(0,250-rgba[i]);sum+=darkness;xsum+=darkness*((i/4)%canvas.width+.5);}return{available:true,centroidX:xsum/sum,canvasCenter:canvas.width/2,minimumDistance:.03*canvas.height/cameraSpan};
},`;
const instrumented=source.replace('window.InkSimulation={','window.InkSimulation={'+hook.replaceAll('\\`','`'));
new Function(instrumented);
(async()=>{const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11']});try{
 const page=await browser.newPage({viewport:{width:1000,height:1050}});await page.emulateMedia({reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/ink.js',route=>route.fulfill({body:instrumented,contentType:'application/javascript'}));await page.goto('http://127.0.0.1:8765/?grid=48');assert(await page.evaluate(()=>!!window.InkSimulation));
 const report={grid:await page.evaluate(()=>InkSimulation.grid),manufactured:{},longRuns:{}};
 for(const mode of ['container','periodic']){
  await page.evaluate(mode=>InkSimulation.qaConfigure(mode),mode);
  const reference=await page.evaluate(()=>InkSimulation.qaManufactured('gradient'));
  const projected=await page.evaluate(reference=>({flow:InkSimulation.diagnostics(),boundary:InkSimulation.qaBoundaryStats(reference)}),reference);
  assert(projected.boundary.referenceError<2e-7,mode+' manufactured pressure gradient projected away');
  assert.equal(projected.boundary.normalMax,0);assert.equal(projected.boundary.ghostVelocityError,0);assert.equal(projected.boundary.ghostScalarError,0);
  report.manufactured[mode]=projected;
 }
 await page.evaluate(()=>InkSimulation.qaConfigure('periodic'));
 const constantReference=await page.evaluate(()=>InkSimulation.qaManufactured('constant'));const constantInitial=await page.evaluate(()=>InkSimulation.diagnostics());await page.evaluate(()=>InkSimulation.step(200));
 report.constant=await page.evaluate(reference=>({flow:InkSimulation.diagnostics(),boundary:InkSimulation.qaBoundaryStats(reference),tracers:InkSimulation.tracerDiagnostics()}),constantReference);
 assert.equal(report.constant.flow.min,.25);assert.equal(report.constant.flow.max,.25);assert(Math.abs(report.constant.flow.mass/constantInitial.mass-1)<1e-12);assert(report.constant.boundary.referenceError<5e-7);assert.equal(report.constant.boundary.ghostVelocityError,0);assert.equal(report.constant.boundary.ghostScalarError,0);assert.equal(report.constant.tracers.escaped,0);assert.equal(report.constant.tracers.outsideActive,0);
 report.minimumImage=await page.evaluate(()=>InkSimulation.qaMinimalImage());assert(Math.abs(report.minimumImage.centroidX-report.minimumImage.canvasCenter)>report.minimumImage.minimumDistance,'Wrapped tracer must stay at a seam rather than streak through the middle');
 for(const mode of ['container','periodic']){
  await page.evaluate(mode=>InkSimulation.qaConfigure(mode),mode);const initial=await page.evaluate(()=>InkSimulation.diagnostics()),tracersInitial=await page.evaluate(()=>InkSimulation.tracerDiagnostics());
  for(let batch=0;batch<60;batch++){await page.evaluate(()=>InkSimulation.step(100));if(batch%20===19)console.log(mode+' '+((batch+1))+' seconds');}
  const flow=await page.evaluate(()=>InkSimulation.diagnostics()),tracers=await page.evaluate(()=>InkSimulation.tracerDiagnostics()),boundaryStats=await page.evaluate(()=>InkSimulation.qaBoundaryStats());
  assert(flow.finite&&flow.min>=-1e-7&&flow.max<1.01);assert(Math.abs(flow.mass/initial.mass-1)<1e-5);assert.equal(flow.escapedMass,0);assert.equal(flow.glError,0);assert.equal(boundaryStats.normalMax,0);assert.equal(boundaryStats.ghostVelocityError,0);assert.equal(boundaryStats.ghostScalarError,0);assert(tracers.finite&&tracers.escaped===0&&tracers.outsideActive===0);assert.equal(tracers.totalAmount,tracersInitial.totalAmount);
  report.longRuns[mode]={initial,flow,tracersInitial,tracers,boundary:boundaryStats};
 }
 report.errors=errors;assert.deepEqual(errors,[]);fs.writeFileSync('qa/boundary-validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
