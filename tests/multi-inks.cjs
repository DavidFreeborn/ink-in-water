// Independent-species regression against the production shaders. Instrumentation
// only configures experiments and reads textures; it does not replace operators.
const fs=require('node:fs');const assert=require('node:assert/strict');const{chromium}=require('playwright');
const source=fs.readFileSync('ink.js','utf8');
const hook=String.raw`qaInkConfigure(options={}){
 running=false;containerShape=options.shape||'cuboid';boundary=options.boundary||'container';
 currentStrength=options.strength??0;initialMotion=currentStrength?'gentle':'still';
 const densities=options.densities||[options.density??.4,options.density2??-.4];
 inks=densities.map((density,index)=>({id:index+1,density,colour:index%2?'#bf6800':'#3657b2'}));activeInkIndex=0;
 chooseSeed(125);allocate(quality);
},async qaInkFingerprint(){
 const result=[];for(const field of [...scalarGroups.map(group=>group.dye[0]),velocity[0],...tracerSets.flatMap(set=>[set.particles[0],set.ids])]){
  const digest=await crypto.subtle.digest('SHA-256',read(field).buffer);result.push(Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join(''));
 }return result;
},qaInkStatistics(){
 const raws=scalarGroups.map(group=>read(group.dye[0])),mask=read(levels[0].geometry),N=dims.active,[nx,ny]=dims.n,columns=dims.columns,width=scalarGroups[0].dye[0].width;
 const offset=q=>((Math.floor(q[2]/columns)*ny+q[1])*width+(q[2]%columns)*nx+q[0])*4;
 const inside=q=>q.every((value,j)=>value>=1&&value<=N[j]);
 const fluid=q=>inside(q)&&(boundary==='periodic'||containerShape==='cuboid'||mask[offset(q)+3]>.5);
 const scalar=Array.from({length:inks.length},()=>({mass:0,min:Infinity,max:-Infinity,centroid:[0,0,0],solidMaximum:0,finite:true}));
 for(let z=1;z<=N[2];z++)for(let y=1;y<=N[1];y++)for(let x=1;x<=N[0];x++){
  const q=[x,y,z],i=offset(q);for(let species=0;species<inks.length;species++){
   const amount=raws[Math.floor(species/4)][i+species%4],s=scalar[species];s.mass+=amount;s.min=Math.min(s.min,amount);s.max=Math.max(s.max,amount);s.finite&&=Number.isFinite(amount);
   for(let axis=0;axis<3;axis++)s.centroid[axis]+=amount*(q[axis]-.5)*h;
   if(!fluid(q))s.solidMaximum=Math.max(s.solidMaximum,Math.abs(amount));
  }
 }
 for(const s of scalar){s.centroid=s.centroid.map(x=>x/s.mass);s.mass*=h**3;}
 const tracers=Array.from({length:inks.length},()=>({mass:0,count:0,centroid:[0,0,0],outside:0,nonpositive:0,finite:true,weightHash:2166136261,idHash:2166136261}));
 if(particleRendering)for(let species=0;species<tracerSets.length;species++){const set=tracerSets[species],raw=read(set.particles[0]),bits=new Uint32Array(raw.buffer),ids=read(set.ids);for(let i=0;i<raw.length;i+=4){
  const weight=raw[i+3];if(weight===0)continue;const t=tracers[species];t.count++;t.mass+=weight;t.weightHash=Math.imul(t.weightHash^bits[i+3],16777619)>>>0;t.idHash=Math.imul(t.idHash^ids[i],16777619)>>>0;
  if(weight<=0)t.nonpositive++;const q=[0,1,2].map(axis=>Math.floor(raw[i+axis]/h)+1);if(!fluid(q))t.outside++;
  for(let axis=0;axis<3;axis++){t.centroid[axis]+=weight*raw[i+axis];t.finite&&=Number.isFinite(raw[i+axis]);}t.finite&&=Number.isFinite(weight);
 }}
 for(const t of tracers)t.centroid=t.centroid.map(x=>x/t.mass);
 return{time:simTime,scalar,tracers};
},`;
const instrumented=source.replace('window.InkSimulation={','window.InkSimulation={'+hook);new Function(instrumented);
function assertConservation(initial,after,label){
 for(let species=0;species<initial.scalar.length;species++){
  const s=after.scalar[species],start=initial.scalar[species],t=after.tracers[species],old=initial.tracers[species];
  assert(start.mass>0&&old.mass>0&&old.count>100000,label+' has a populated independent species '+species);
  assert(s.finite&&s.min>=-1e-7&&s.max<1.02,label+' bounded concentration '+species);
  assert(Math.abs(s.mass/start.mass-1)<1e-5,label+' conserved Eulerian mass '+species);assert.equal(s.solidMaximum,0);
  assert(t.finite);assert.equal(t.outside,0,label+' tracer containment '+species);assert.equal(t.nonpositive,0);
  for(const key of ['mass','count','weightHash','idHash'])assert.equal(t[key],old[key],label+' invariant tracer '+key+' species '+species);
 }
}
(async()=>{const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11']});try{
 const page=await browser.newPage({viewport:{width:950,height:950}});await page.emulateMedia({reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.route('**/ink.js',route=>route.fulfill({body:instrumented,contentType:'application/javascript'}));await page.goto('http://127.0.0.1:8765/?grid=32');
 assert(await page.evaluate(()=>!!window.InkSimulation),'Production shaders compile and initialize');
 const report={grid:await page.evaluate(()=>InkSimulation.grid),stress:{}};
 // Zero and nonzero second-ink density isolate its contribution to momentum.
 await page.evaluate(()=>InkSimulation.qaInkConfigure({density:0,density2:0}));await page.evaluate(()=>InkSimulation.step(100));
 const neutral=await page.evaluate(()=>InkSimulation.diagnostics());assert.equal(neutral.maxSpeed,0,'Both neutral inks leave still water at rest');
 await page.evaluate(()=>InkSimulation.qaInkConfigure({density:0,density2:.4}));const secondInitial=await page.evaluate(()=>InkSimulation.qaInkStatistics());await page.evaluate(()=>InkSimulation.step(100));
 const secondAfter=await page.evaluate(()=>InkSimulation.qaInkStatistics()),secondFlow=await page.evaluate(()=>InkSimulation.diagnostics());
 assert(secondFlow.maxSpeed>.001,'The second density contributes to the fluid force');
 assert(secondAfter.scalar[1].centroid[1]<secondInitial.scalar[1].centroid[1]-.001,'Positive second density sinks');assertConservation(secondInitial,secondAfter,'Second-density isolation');
 report.secondDensity={neutral,flow:secondFlow,initial:secondInitial,after:secondAfter};
 // Opposite buoyancies must separate vertically in both scalar and tracer views.
 await page.evaluate(()=>InkSimulation.qaInkConfigure());const oppositeInitial=await page.evaluate(()=>InkSimulation.qaInkStatistics());await page.evaluate(()=>InkSimulation.step(100));
 const oppositeAfter=await page.evaluate(()=>InkSimulation.qaInkStatistics());assertConservation(oppositeInitial,oppositeAfter,'Opposite buoyancy');
 for(const representation of ['scalar','tracers']){
  assert(oppositeAfter[representation][0].centroid[1]<oppositeInitial[representation][0].centroid[1]-.001,representation+' denser ink sinks');
  assert(oppositeAfter[representation][1].centroid[1]>oppositeInitial[representation][1].centroid[1]+.001,representation+' lighter ink rises');
 }
 report.opposite={initial:oppositeInitial,after:oppositeAfter};
 const beforeColours=await page.evaluate(()=>InkSimulation.qaInkFingerprint());
 await page.locator('#ink-hex').fill('#ef3271');await page.locator('#ink-hex').press('Tab');await page.locator('#ink-select').selectOption('1');await page.locator('#ink-hex').fill('#137953');await page.locator('#ink-hex').press('Tab');
 const afterColours=await page.evaluate(()=>InkSimulation.qaInkFingerprint());assert.deepEqual(afterColours,beforeColours,'Colour controls leave every physics texture bit-identical');
 await page.evaluate(()=>InkSimulation.step(30));const colouredFuture=await page.evaluate(()=>InkSimulation.qaInkFingerprint());
 await page.evaluate(()=>{InkSimulation.qaInkConfigure();InkSimulation.step(130);});const originalFuture=await page.evaluate(()=>InkSimulation.qaInkFingerprint());
 assert.deepEqual(colouredFuture,originalFuture,'Colour choice cannot affect subsequent numerical evolution');report.colours={beforeColours,afterColours,colouredFuture,originalFuture};
 for(const [shape,boundary]of [['cuboid','container'],['cylinder','container'],['sphere','container'],['sphere','periodic']]){
  const label=boundary==='periodic'?'torus':shape;await page.evaluate(options=>InkSimulation.qaInkConfigure(options),{shape,boundary,strength:3,density:1.2,density2:-.4});
  const initial=await page.evaluate(()=>InkSimulation.qaInkStatistics());for(let batch=0;batch<5;batch++)await page.evaluate(()=>InkSimulation.step(100));
  const after=await page.evaluate(()=>InkSimulation.qaInkStatistics()),flow=await page.evaluate(()=>InkSimulation.diagnostics());assertConservation(initial,after,label+' maximum-current run');
  assert(flow.finite&&flow.glError===0&&flow.divergenceAfter<3e-4,label+' incompressible finite flow');report.stress[label]={initial,after,flow};console.log('Two inks: '+label+' 5 s at maximum current PASS.');
 }
 // Exercise all three supported species, including independent force from the last ink.
 report.many={};
 for(const count of [3]){
  const densities=Array.from({length:count},(_,i)=>i===count-1?.4:0);
  await page.evaluate(options=>InkSimulation.qaInkConfigure(options),{densities,shape:'sphere'});
  const initial=await page.evaluate(()=>InkSimulation.qaInkStatistics());
  await page.evaluate(()=>InkSimulation.step(100));
  const after=await page.evaluate(()=>InkSimulation.qaInkStatistics()),flow=await page.evaluate(()=>InkSimulation.diagnostics());
  assertConservation(initial,after,count+' independent inks');
  assert(flow.maxSpeed>.001,'Last ink contributes its own buoyancy');
  assert(after.scalar[count-1].centroid[1]<initial.scalar[count-1].centroid[1]-.001,'Last ink sinks');
  assert.equal(flow.perInk.length,count);assert.equal(flow.glError,0);
  report.many[count]={initial,after,flow};console.log(count+' independent inks PASS.');
 }
 assert.deepEqual(errors,[]);report.errors=errors;fs.writeFileSync('qa/multi-inks-validation.json',JSON.stringify(report,null,2));
 const summary={secondDensityMaxSpeed:secondFlow.maxSpeed,oppositeCentroidChanges:oppositeAfter.scalar.map((s,i)=>s.centroid[1]-oppositeInitial.scalar[i].centroid[1]),colourPhysicsIdentical:true,stress:Object.fromEntries(Object.entries(report.stress).map(([name,r])=>[name,{massDrift:r.after.scalar.map((s,i)=>s.mass/r.initial.scalar[i].mass-1),divergence:r.flow.divergenceAfter,tracerCounts:r.after.tracers.map(t=>t.count),outside:r.after.tracers.map(t=>t.outside)}]))};
 console.log(JSON.stringify(summary,null,2));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
