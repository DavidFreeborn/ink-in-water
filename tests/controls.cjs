// Exercise seed reproducibility and playback without changing the production solver.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const source = fs.readFileSync('ink.js', 'utf8');
const hook = `fingerprint(){
  return [dye[0],velocity[0],particles[0]].map(f=>{
    const values=read(f),bits=new Uint32Array(values.buffer);let hash=2166136261;
    for(const value of bits)hash=Math.imul(hash^value,16777619);return hash>>>0;
  });
},tracerDiagnostics(){`;
const instrumented = source.replace('tracerDiagnostics(){', hook);
assert.notEqual(instrumented, source);
(async()=>{
  const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11']});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:800}});
    await page.emulateMedia({reducedMotion:'reduce'});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/ink.js',route=>route.fulfill({body:instrumented,contentType:'text/javascript'}));
    await page.goto('http://127.0.0.1:8765/?grid=32');
    await page.waitForFunction(()=>window.InkSimulation);
    assert.equal(await page.locator('#toggle').textContent(),'Play');
    assert.equal(await page.locator('#speed').inputValue(),'1');
    assert.equal(await page.locator('#boundary').inputValue(),'container');
    const firstSeed=await page.locator('#seed').inputValue();
    await page.reload();
    await page.waitForFunction(()=>window.InkSimulation);
    assert.notEqual(await page.locator('#seed').inputValue(),firstSeed,'Fresh load chooses a fresh seed');
    await page.locator('#seed').fill('4294967295');
    await page.locator('#seed').press('Tab');
    const first=await page.evaluate(()=>{InkSimulation.step(40);return InkSimulation.fingerprint();});
    await page.locator('#reset').click();
    const second=await page.evaluate(()=>{InkSimulation.step(40);return InkSimulation.fingerprint();});
    assert.deepEqual(second,first,'Reset repeats seed and fixed physics exactly');
    await page.locator('#random-seed').click();
    const newSeed=await page.locator('#seed').inputValue();
    assert.notEqual(newSeed,'4294967295');
    const third=await page.evaluate(()=>{InkSimulation.step(40);return InkSimulation.fingerprint();});
    assert.notEqual(third[0],first[0],'Seed changes the resolved dye shape');
    assert.notEqual(third[1],first[1],'Seed changes the resolved initial currents');
    assert.notEqual(third[2],first[2],'Seed changes tracer sampling');
    const rates=[];
    for(const speed of [.5,1]){
      await page.locator('#speed').fill(String(speed));
      await page.locator('#reset').click();
      const start=await page.evaluate(()=>{InkSimulation.play();return performance.now();});
      await page.waitForTimeout(1800);
      const result=await page.evaluate(start=>{InkSimulation.pause();return{wall:(performance.now()-start)/1000,simulation:InkSimulation.time};},start);
      rates.push({...result,requested:speed,rate:result.simulation/result.wall});
    }
    assert(rates[1].rate>rates[0].rate*1.45,'Higher speed advances faster using unchanged physics steps');
    await page.locator('#boundary').selectOption('periodic');
    assert.equal(await page.evaluate(()=>InkSimulation.time),0,'Boundary change starts the new physical setup');
    assert.equal(await page.locator('details input, details select, details button').count(),0,'Model description contains no hidden controls');
    await page.locator('#step').click();
    await page.waitForFunction(()=>Math.abs(InkSimulation.time-.1)<1e-7);
    assert.deepEqual(errors,[]);
    fs.writeFileSync('qa/controls.json',JSON.stringify({firstSeed,newSeed,first,second,third,rates,errors},null,2));
    console.log(JSON.stringify({reproducible:true,randomDefault:true,rates,errors},null,2));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
