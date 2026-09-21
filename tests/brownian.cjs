// Neutral-water regression for the production Brownian tracer implementation.
// Adds read-only diagnostics through an intercepted copy; it does not replace RNG or transport.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const sourcePath = process.env.INK_SOURCE || 'ink.js';
const source = fs.readFileSync(sourcePath, 'utf8');
const hook = String.raw`brownianStatistics(){
 const now=read(particles[0]);
 if(!window.inkRngInitial){window.inkRngInitial=now;return {initial:true};}
 const initial=window.inkRngInitial;let totalWeight=0,count=0;
 const mean=[0,0,0],second=Array(9).fill(0);
 for(let i=0;i<now.length;i+=4){const w=initial[i+3];if(w<=0)continue;
  totalWeight+=w;count++;const delta=[now[i]-initial[i],now[i+1]-initial[i+1],now[i+2]-initial[i+2]];
  for(let a=0;a<3;a++){mean[a]+=w*delta[a];for(let b=0;b<3;b++)second[3*a+b]+=w*delta[a]*delta[b];}}
 for(let a=0;a<3;a++)mean[a]/=totalWeight;
 const covariance=second.map((x,i)=>x/totalWeight-mean[Math.floor(i/3)]*mean[i%3]);
 return{time:simTime,count,mean,covariance,targetVariance:2e-9*simTime};
 },tracerDiagnostics(){`;
const instrumented = source.replace('tracerDiagnostics(){', hook);
assert.notEqual(instrumented, source, 'Read-only diagnostics hook found');
(async () => {
 const browser = await chromium.launch({headless:true,args:['--use-angle=d3d11']});
 try {
  const page=await browser.newPage(); await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/ink.js',route=>route.fulfill({body:instrumented,contentType:'text/javascript'}));
  await page.goto('http://127.0.0.1:8765/?grid=32');
  await page.locator('#current-strength').fill('0');
  await page.locator('#density').fill('0');
  await page.locator('#reset').click();
  await page.evaluate(()=>InkSimulation.brownianStatistics());
  await page.evaluate(()=>InkSimulation.step(200));
  const result=await page.evaluate(()=>({statistics:InkSimulation.brownianStatistics(),flow:InkSimulation.diagnostics(),tracers:InkSimulation.tracerDiagnostics()}));
  const {statistics:s}=result;
  assert.equal(result.flow.maxSpeed,0,'Neutral still water must remain at rest');
  assert.equal(result.tracers.escaped,0,'No tracer should reach the distant boundary');
  for(let a=0;a<3;a++){
   assert(Math.abs(s.mean[a])<2e-6,'Mean Brownian displacement below 2 micrometres');
   assert(Math.abs(s.covariance[3*a+a]/s.targetVariance-1)<.02,'Per-axis variance within 2% of 2Dt');
   for(let b=0;b<3;b++)if(a!==b)assert(Math.abs(s.covariance[3*a+b]/s.targetVariance)<.02,'Cross-axis covariance below 2% of 2Dt');
  }
  fs.writeFileSync('qa/brownian-production.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
