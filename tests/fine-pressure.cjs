// Regression for the under-resolved Fine pressure hierarchy and initial impulse.
const fs=require('node:fs');const assert=require('node:assert/strict');const{chromium}=require('playwright');
const source=fs.readFileSync('ink.js','utf8');
const instrumented=source.replace('window.InkSimulation={','window.InkSimulation={pressureHierarchy(){return levels.map(level=>level.g.active.slice());},');
(async()=>{const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11']});try{
 const page=await browser.newPage();await page.emulateMedia({reducedMotion:'reduce'});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/ink.js',route=>route.fulfill({body:instrumented,contentType:'application/javascript'}));await page.goto('http://127.0.0.1:8765/');
 await page.locator('#seed').fill('125');await page.locator('#seed').press('Tab');await page.locator('#current-strength').fill('1');await page.locator('#quality').selectOption('fine');
 assert.deepEqual(await page.evaluate(()=>InkSimulation.grid),[160,240,160]);
 const hierarchy=await page.evaluate(()=>InkSimulation.pressureHierarchy());assert.deepEqual(hierarchy,[[160,240,160],[80,120,80],[40,60,40],[20,30,20],[10,15,10]]);
 const result={hierarchy,modes:{}};
 for(const mode of ['container','periodic']){
  await page.locator('#domain').selectOption(mode==='container'?'cuboid':'periodic');await page.locator('#reset').click();
  const initial=await page.evaluate(()=>InkSimulation.diagnostics());
  assert(initial.divergenceAfter<2e-5,mode+' initial velocity must be projected');
  await page.evaluate(()=>InkSimulation.step(20));const after=await page.evaluate(()=>InkSimulation.diagnostics());
  assert(after.divergenceAfter<2e-5,mode+' Fine projection residual');
  assert(after.divergenceAfter<.01*after.divergenceBefore,mode+' projection removes at least99% of divergence');
  assert(Math.abs(after.mass/initial.mass-1)<1e-5,mode+' dye amount conserved');
  assert(after.finite&&after.min>=-1e-8&&after.max<1.01&&after.glError===0);
  result.modes[mode]={initial,after};
 }
 assert.deepEqual(errors,[]);result.errors=errors;fs.writeFileSync('qa/fine-pressure-validation.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
