// Neutral-water regression for the production Brownian tracer implementation.
// Read-only diagnostics test each ink's diffusion and independence between species.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const source = fs.readFileSync(process.env.INK_SOURCE || 'ink.js', 'utf8');
const hook = String.raw`brownianStatistics(){
 const samples=tracerSets.map(set=>({id:set.id,count:set.count,now:read(set.particles[0]),ids:read(set.ids)}));
 if(!window.inkRngInitial){
  window.inkRngInitial=new Map(samples.map(sample=>[sample.id,sample.now]));
  invalidateRenderState();return{initial:true,ids:samples.map(sample=>sample.id)};
 }
 const initialById=window.inkRngInitial;
 const perInk=samples.map(sample=>{
  const now=sample.now,initial=initialById.get(sample.id);let totalWeight=0,count=0;
  const mean=[0,0,0],second=Array(9).fill(0);
  for(let i=0;i<now.length;i+=4){const weight=initial[i+3];if(weight<=0)continue;
   totalWeight+=weight;count++;
   const delta=[now[i]-initial[i],now[i+1]-initial[i+1],now[i+2]-initial[i+2]];
   for(let a=0;a<3;a++){mean[a]+=weight*delta[a];for(let b=0;b<3;b++)second[3*a+b]+=weight*delta[a]*delta[b];}
  }
  for(let a=0;a<3;a++)mean[a]/=totalWeight;
  return{id:sample.id,count,mean,covariance:second.map((value,i)=>value/totalWeight-mean[Math.floor(i/3)]*mean[i%3])};
 });
 // Packed samples keep local quadrature IDs in ascending order. Match those IDs,
 // not packed array positions, to compare independent species' random walks.
 let crossInk=null;
 if(samples.length>=2){
  const left=samples[0],right=samples[1],leftInitial=initialById.get(left.id),rightInitial=initialById.get(right.id);
  const meanLeft=[0,0,0],meanRight=[0,0,0],second=Array(9).fill(0);let weightSum=0,count=0,i=0,j=0;
  while(i<left.count&&j<right.count){
   const li=i*4,rj=j*4,leftId=left.ids[li],rightId=right.ids[rj];
   if(leftId<rightId){i++;continue;}if(rightId<leftId){j++;continue;}
   const weight=Math.min(leftInitial[li+3],rightInitial[rj+3]);
   const dl=[0,1,2].map(axis=>left.now[li+axis]-leftInitial[li+axis]);
   const dr=[0,1,2].map(axis=>right.now[rj+axis]-rightInitial[rj+axis]);
   weightSum+=weight;count++;
   for(let a=0;a<3;a++){meanLeft[a]+=weight*dl[a];meanRight[a]+=weight*dr[a];for(let b=0;b<3;b++)second[3*a+b]+=weight*dl[a]*dr[b];}
   i++;j++;
  }
  for(let a=0;a<3;a++){meanLeft[a]/=weightSum;meanRight[a]/=weightSum;}
  crossInk={ids:[left.id,right.id],count,covariance:second.map((value,k)=>value/weightSum-meanLeft[Math.floor(k/3)]*meanRight[k%3])};
 }
 invalidateRenderState();return{time:simTime,perInk,crossInk,targetVariance:2e-9*simTime};
},tracerDiagnostics(){`;
const instrumented = source.replace('tracerDiagnostics(){', hook);
assert.notEqual(instrumented, source, 'Read-only diagnostics hook found');
(async () => {
 const browser = await chromium.launch({headless:true,args:['--use-angle=d3d11']});
 try {
  const page=await browser.newPage();await page.emulateMedia({reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/ink.js',route=>route.fulfill({body:instrumented,contentType:'text/javascript'}));
  await page.goto('http://127.0.0.1:8765/?grid=32');
  await page.waitForFunction(()=>window.InkSimulation);
  await page.evaluate(()=>InkSimulation.restoreSettings({modelVersion:5,inks:[{id:1,density:0,colour:'#3657b2'},{id:17,density:0,colour:'#c1681c'}],activeInkIndex:0,currentStrength:0,domain:'cuboid',seed:4718593,quality:'standard'}));
  const initial=await page.evaluate(()=>InkSimulation.brownianStatistics());
  assert.deepEqual(initial.ids,[1,17],'Independent species use persistent, nonconsecutive identities');
  await page.evaluate(()=>InkSimulation.step(200));
  const result=await page.evaluate(()=>({statistics:InkSimulation.brownianStatistics(),flow:InkSimulation.diagnostics(),tracers:InkSimulation.tracerDiagnostics()}));
  const {statistics:s}=result;
  assert.equal(result.flow.maxSpeed,0,'Neutral still water must remain at rest');
  assert.equal(result.tracers.escaped,0,'No tracer should reach the distant boundary');
  assert.equal(result.tracers.finite,true);
  assert.equal(s.perInk.length,2);
  for(const ink of s.perInk){
   assert(ink.count>1000,'Each ink has enough samples to assess Brownian statistics');
   for(let a=0;a<3;a++){
    assert(Math.abs(ink.mean[a])<2e-6,'Mean Brownian displacement below 2 micrometres for ink '+ink.id);
    assert(Math.abs(ink.covariance[3*a+a]/s.targetVariance-1)<.02,'Per-axis variance within 2% of 2Dt for ink '+ink.id);
    for(let b=0;b<3;b++)if(a!==b)assert(Math.abs(ink.covariance[3*a+b]/s.targetVariance)<.02,'Cross-axis covariance below 2% of 2Dt for ink '+ink.id);
   }
  }
  assert(s.crossInk.count>1000,'Species share enough local quadrature IDs for the independence check');
  for(const covariance of s.crossInk.covariance)assert(Math.abs(covariance/s.targetVariance)<.03,'Different ink IDs must not share the same Brownian noise');
  assert.deepEqual(errors,[]);
  fs.mkdirSync('qa',{recursive:true});fs.writeFileSync('qa/brownian-production.json',JSON.stringify({...result,errors},null,2));
  console.log(JSON.stringify({...result,errors},null,2));
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
