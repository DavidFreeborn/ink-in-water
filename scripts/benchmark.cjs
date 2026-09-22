// Start the local server, then run:
// node scripts/benchmark.cjs --source qa/ink-count-baseline.js --mode both
// Optional: --counts 1,2,3,4 --fast --windows 3 --window-ms 1000 --output qa/ink-count-baseline
// --timing-only omits playback and includes blocking readback in step/render timing.
// Hooks observe the production solver; they do not replace its steps or shaders.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {chromium}=require('playwright');
const args=process.argv.slice(2);
function option(name,fallback){const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];}
const sourcePath=path.resolve(option('source','ink.js'));
const source=fs.readFileSync(sourcePath,'utf8');
const mode=option('mode','standard');
if(!['standard','fine','both'].includes(mode))throw Error('Mode must be standard, fine, or both');
const countsOption=option('counts',null);
const parseCounts=value=>{const counts=value.split(',').map(Number);if(!counts.length||counts.some(n=>!Number.isInteger(n)||n<1||n>16))throw Error('Counts must be integers from 1 to 16');return counts;};
const windows=Number(option('windows','3')),windowMs=Number(option('window-ms','1000'));
const warmupSteps=Number(option('warmup','20')),stepSamples=Number(option('step-samples','9'));
if(!Number.isInteger(windows)||windows<1||!Number.isFinite(windowMs)||windowMs<100||!Number.isInteger(warmupSteps)||warmupSteps<0||!Number.isInteger(stepSamples)||stepSamples<1)throw Error('Invalid benchmark sample settings');
const output=path.resolve(option('output','qa/ink-count-benchmark'));
const url=option('url','http://127.0.0.1:8765/');
const speeds=args.includes('--timing-only')?[]:args.includes('--fast')?[1,6]:[1];
const hook=String.raw`benchmarkInfo(){
 const extension=gl.getExtension('WEBGL_debug_renderer_info');
 return{grid:dims.active.slice(),time:simTime,dt:DT,textureBytes:fields.reduce((sum,f)=>sum+f.width*f.height*f.channels*4,0),textureCount:fields.length,
  tracers:tracerSets.map(set=>({id:set.id,count:set.count})),canvas:[canvas.width,canvas.height],particleRendering,
  renderer:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),contextLost:gl.isContextLost(),glError:gl.getError()};
},benchmarkAllocate(settings){gl.finish();gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));const previousFields=fields;let started=performance.now();restore({modelContent:{modelVersion:5,...settings}});if(fields===previousFields){gl.finish();gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));started=performance.now();allocate(quality);}gl.finish();gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));return performance.now()-started;
},benchmarkWarmup(count,fromReset=false){running=false;manualSteps=0;accumulator=0;if(fromReset)reset();for(let i=0;i<count;i++)advance();render();updateUI();gl.finish();gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));return simTime;
},benchmarkStep(){gl.finish();gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));const started=performance.now();advance();gl.finish();gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,new Float32Array(4));return performance.now()-started;
},benchmarkRender(){gl.finish();gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));const started=performance.now();render();gl.finish();gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));return performance.now()-started;
},tracerDiagnostics(){`;
if(!source.includes('tracerDiagnostics(){'))throw Error('Production diagnostics hook unavailable');
const instrumented=source.replace('tracerDiagnostics(){',hook);
const sourceHash=crypto.createHash('sha256').update(source).digest('hex');
function summary(values){
 const sorted=values.slice().sort((a,b)=>a-b),q=p=>{const position=p*(sorted.length-1),low=Math.floor(position),high=Math.ceil(position);return sorted[low]+(sorted[high]-sorted[low])*(position-low);};
 return{median:q(.5),p10:q(.1),p90:q(.9),min:sorted[0],max:sorted.at(-1),samples:values};
}
const report={createdAt:new Date().toISOString(),sourcePath,sourceSha256:sourceHash,protocol:{viewport:[1280,800],deviceScaleFactor:1,seed:125,domain:'cuboid',currentStrength:1,densityPercent:.04,warmupSteps,stepSamples,windows,windowMs,speeds,physicsTiming:'advance() bracketed by gl.finish() and blocking one-pixel readback; includes synchronization overhead',renderTiming:'render() bracketed by gl.finish() and blocking one-pixel readback; includes synchronization overhead',playbackTiming:'Production requestAnimationFrame loop; frame interval and simulated-time measurements; no gl.finish() during playback',allocationTiming:'One full allocate/seed/render with completion readback; if settings restore only resets existing fields, a fresh allocate is measured separately',textureAccounting:'Live application float texture storage only, excluding driver overhead, default framebuffer, compilation and transient allocation peaks'},cases:[]};
fs.mkdirSync(path.dirname(output),{recursive:true});
function persist(){fs.writeFileSync(output+'.json',JSON.stringify(report,null,2));}
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11']});
 try{
  for(const quality of mode==='both'?['standard','fine']:[mode]){
   const counts=countsOption?parseCounts(countsOption):[1,2,3,4,5];
   for(const count of counts){
    const result={quality,count};report.cases.push(result);persist();
    console.log('START',quality,count);
    const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1,reducedMotion:'reduce'});
    const page=await context.newPage();page.setDefaultTimeout(120000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    try{
     await page.route('**/ink.js',route=>route.fulfill({body:instrumented,contentType:'text/javascript'}));
     const opened=Date.now();await page.goto(url);await page.waitForFunction(()=>window.InkSimulation||!document.querySelector('#sim-error').hidden);
     if(!await page.evaluate(()=>!!window.InkSimulation))throw Error(await page.locator('#sim-error').textContent());
     result.initialLoadMs=Date.now()-opened;
     const colours=['#3657b2','#c18c2f','#4c9b73','#aa4267','#8061bf','#397d9c'];
     const settings={modelVersion:5,inks:Array.from({length:count},(_,i)=>({id:i+1,density:.04,colour:colours[i%colours.length]})),activeInkIndex:0,quality,seed:125,currentStrength:1,domain:'cuboid',viewAngleDegrees:0,playbackSpeed:1};
     result.allocationMs=await page.evaluate(settings=>InkSimulation.benchmarkAllocate(settings),settings);
     await page.evaluate(n=>InkSimulation.benchmarkWarmup(n),warmupSteps);
     result.initial=await page.evaluate(()=>InkSimulation.benchmarkInfo());
     if(result.initial.contextLost||result.initial.glError!==0)throw Error('Graphics failure after allocation: '+JSON.stringify(result.initial));
     if(result.initial.grid[0]!==({standard:112,fine:160}[quality]))throw Error('Unexpected production grid');
     if(result.initial.tracers.length!==count)throw Error('Requested ink allocation did not succeed');
     const steps=[];for(let i=0;i<stepSamples;i++)steps.push(await page.evaluate(()=>InkSimulation.benchmarkStep()));
     result.physicsMs=summary(steps);
     const renders=[];for(let i=0;i<5;i++)renders.push(await page.evaluate(()=>InkSimulation.benchmarkRender()));
     result.renderMs=summary(renders);
     result.playback=[];
     for(const speed of speeds){
      await page.evaluate(n=>InkSimulation.benchmarkWarmup(n,true),warmupSteps);
      await page.locator('#speed').fill(String(speed));
      const playback=await page.evaluate(async({windows,windowMs})=>{
       const all=[],startTime=InkSimulation.time;let intervals=[],last=performance.now(),frameId;
       const observe=now=>{intervals.push(now-last);last=now;frameId=requestAnimationFrame(observe);};
       frameId=requestAnimationFrame(observe);InkSimulation.play();
       for(let i=0;i<windows;i++){
        const start=performance.now(),sim=InkSimulation.time;
        await new Promise(resolve=>setTimeout(resolve,windowMs));
        const wallMs=performance.now()-start,simulationSeconds=InkSimulation.time-sim;
        all.push({wallMs,simulationSeconds,simulationRate:simulationSeconds/(wallMs/1000),fps:intervals.length/(wallMs/1000),frameIntervalsMs:intervals});intervals=[];
       }
       InkSimulation.pause();cancelAnimationFrame(frameId);return{startTime,endTime:InkSimulation.time,windows:all};
      },{windows,windowMs});
      result.playback.push({requestedSpeed:speed,...playback,fps:summary(playback.windows.map(w=>w.fps)),simulationRate:summary(playback.windows.map(w=>w.simulationRate)),frameIntervalMs:summary(playback.windows.flatMap(w=>w.frameIntervalsMs))});
     }
     result.final=await page.evaluate(()=>InkSimulation.benchmarkInfo());result.errors=errors;
     if(result.final.contextLost||result.final.glError!==0)throw Error('Graphics failure during benchmark: '+JSON.stringify(result.final));
     if(await page.locator('#sim-error').isVisible())throw Error(await page.locator('#sim-error').textContent());
     if(errors.length)throw Error('Browser errors: '+errors.join('; '));
     const one=result.playback[0];
     console.log('RESULT',JSON.stringify({quality,count,allocationMs:result.allocationMs,textureMiB:result.initial.textureBytes/1048576,tracers:result.initial.tracers.reduce((n,s)=>n+s.count,0),stepMs:result.physicsMs.median,renderMs:result.renderMs.median,fps:one?.fps.median,rate:one?.simulationRate.median,errors}));
    }catch(error){result.error=error.stack||String(error);console.log('FAILED',quality,count,result.error);}
    finally{await context.close();persist();}
   }
  }
 }finally{await browser.close();report.finishedAt=new Date().toISOString();persist();}
 const lines=['# Ink count benchmark','',`Source SHA-256: ${sourceHash}`,'','| Quality | Inks | Textures MiB | Allocation ms | Step ms, median | Render ms, median | Playback FPS at 1× | Actual simulated s / wall s |','|---|---:|---:|---:|---:|---:|---:|---:|'];
 for(const c of report.cases){if(c.error){lines.push(`| ${c.quality} | ${c.count} | Failed | | | | | |`);continue;}lines.push(`| ${c.quality} | ${c.count} | ${(c.initial.textureBytes/1048576).toFixed(1)} | ${c.allocationMs.toFixed(0)} | ${c.physicsMs.median.toFixed(1)} | ${c.renderMs.median.toFixed(1)} | ${c.playback[0]?.fps.median.toFixed(1)||'—'} | ${c.playback[0]?.simulationRate.median.toFixed(3)||'—'} |`);}
 lines.push('','Physics and render timings include GPU completion. Playback uses the unmodified production loop. Full medians, p10/p90, ranges, samples, hardware identity and protocol are in the JSON report. Texture totals exclude driver overhead and temporary allocation peaks.');
 fs.writeFileSync(output+'.md',lines.join('\n')+'\n');
 if(report.cases.some(c=>c.error))process.exitCode=1;
})().catch(error=>{console.error(error);persist();process.exitCode=1;});
