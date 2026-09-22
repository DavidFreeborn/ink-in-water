// Exercise deterministic playback, the selected-ink editor, and saved-setting migration.
// Diagnostics are added to an intercepted copy without changing the production solver.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const source = fs.readFileSync(process.env.INK_SOURCE || 'ink.js', 'utf8');
const hook = String.raw`fingerprint(){
  const fields=[...scalarGroups.map(group=>group.dye[0]),velocity[0],...tracerSets.map(set=>set.particles[0])];
  const result=fields.map(field=>{
    const data=read(field),bits=new Uint32Array(data.buffer);let hash=2166136261;
    for(const value of bits)hash=Math.imul(hash^value,16777619);return hash>>>0;
  });
  invalidateRenderState();return result;
},tracerDiagnostics(){`;
const instrumented = source.replace('tracerDiagnostics(){', hook);
assert.notEqual(instrumented, source, 'Read-only diagnostics hook found');
(async()=>{
  const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11']});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:800}});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.addInitScript(()=>{
      window.savedInkSnapshots=[];
      window.openai={setWidgetState(snapshot){window.savedInkSnapshots.push(structuredClone(snapshot));return Promise.resolve();}};
    });
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/ink.js',route=>route.fulfill({body:instrumented,contentType:'text/javascript'}));
    await page.goto('http://127.0.0.1:8765/?grid=32');
    await page.waitForFunction(()=>window.InkSimulation);
    assert.equal(await page.locator('#toggle').textContent(),'Play');
    assert.equal(await page.locator('#speed').inputValue(),'1');
    assert.equal(await page.locator('#domain').inputValue(),'cuboid');
    assert.equal(await page.locator('#remove-ink').isDisabled(),true,'The final ink cannot be removed');
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
    await page.locator('#domain').selectOption('periodic');
    assert.equal(await page.evaluate(()=>InkSimulation.time),0,'Domain change starts the new physical setup');
    const span=await page.evaluate(()=>InkSimulation.camera.span);
    for(const angle of [-180,-135,-90,0,90,135,180]){
      await page.locator('#angle').fill(String(angle));
      assert.equal(await page.locator('#angle-value').textContent(),angle+'°');
      assert.equal(await page.evaluate(()=>InkSimulation.camera.span),span,'Full rotation retains a fixed view of the entire volume');
    }
    assert.equal(await page.locator('details input, details select, details button').count(),0,'Model description contains no hidden controls');
    await page.locator('#step').click();
    await page.waitForFunction(()=>Math.abs(InkSimulation.time-.1)<1e-7);

    // A single shared editor operates on the selected species without resetting time.
    const original=await page.evaluate(()=>InkSimulation.settings.inks[0]);
    await page.locator('#add-ink').click();
    let settings=await page.evaluate(()=>InkSimulation.settings);
    assert.equal(settings.inks.length,2);
    assert.equal(settings.activeInkIndex,1,'New ink becomes selected');
    assert.equal(await page.evaluate(()=>InkSimulation.time),0,'Adding an ink starts its initial setup');
    await page.evaluate(()=>InkSimulation.step(5));
    const editTime=await page.evaluate(()=>InkSimulation.time);
    await page.locator('#density').fill('0.13');
    settings=await page.evaluate(()=>InkSimulation.settings);
    assert.equal(settings.inks[1].density,.13);
    assert.deepEqual(settings.inks[0],original,'Editing the selected ink preserves the other ink');
    assert.equal(await page.evaluate(()=>InkSimulation.time),editTime,'Density edit is live');
    const beforeColour=await page.evaluate(()=>InkSimulation.fingerprint());
    await page.locator('#ink-colour').evaluate(input=>{input.value='#2f6d93';input.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.evaluate(()=>InkSimulation.settings.inks[1].colour),'#2f6d93','Native picker input changes exact colour live');
    assert.equal(await page.locator('#ink-hex').inputValue(),'#2f6d93');
    assert.equal(await page.evaluate(()=>InkSimulation.time),editTime);
    assert.deepEqual(await page.evaluate(()=>InkSimulation.fingerprint()),beforeColour,'Optical edits preserve all physical fields');
    await page.locator('#ink-hex').fill('12AbEf');
    await page.locator('#ink-hex').press('Enter');
    assert.equal(await page.locator('#ink-hex').inputValue(),'#12abef','Hex edits normalize case and optional hash');
    assert.equal(await page.locator('#ink-colour').inputValue(),'#12abef');
    assert.equal(await page.evaluate(()=>InkSimulation.settings.inks[1].colour),'#12abef');
    await page.locator('#ink-hex').fill('#12zzzz');
    await page.locator('#ink-hex').dispatchEvent('change');
    assert.equal(await page.locator('#ink-hex').evaluate(input=>input.validity.valid),false,'Invalid hex exposes native validation');
    assert.equal(await page.locator('#ink-hex').getAttribute('aria-invalid'),'true');
    assert.equal(await page.evaluate(()=>InkSimulation.settings.inks[1].colour),'#12abef','Invalid text never changes committed colour');
    await page.locator('#ink-hex').press('Escape');
    assert.equal(await page.locator('#ink-hex').inputValue(),'#12abef');
    assert.equal(await page.locator('#ink-hex').evaluate(input=>input.validity.valid),true,'Escape clears invalid editing state');
    await page.locator('#ink-hex').fill('oops');
    await page.locator('#ink-hex').dispatchEvent('change');
    await page.locator('#seed').focus();
    assert.equal(await page.locator('#ink-hex').inputValue(),'#12abef','Leaving an invalid edit restores committed colour');
    await page.locator('#ink-select').selectOption('0');
    assert.equal(await page.locator('#ink-colour').inputValue(),original.colour);
    assert.equal(Number(await page.locator('#density').inputValue()),original.density);
    assert.equal(await page.evaluate(()=>InkSimulation.time),editTime,'Selection changes only the editor');

    // Species retain identities when a middle entry is removed and labels are renumbered.
    await page.locator('#add-ink').click();
    assert.equal(await page.locator('#add-ink').isDisabled(),true,'The three-ink limit prevents additional allocation');
    assert.equal(await page.evaluate(()=>InkSimulation.settings.maxInks),3);
    const beforeRemoval=await page.evaluate(()=>InkSimulation.settings.inks);
    assert.equal(beforeRemoval.length,3);
    await page.locator('#ink-select').selectOption('1');
    await page.locator('#remove-ink').click();
    const afterRemoval=await page.evaluate(()=>InkSimulation.settings.inks);
    assert.deepEqual(afterRemoval.map(ink=>ink.id),[beforeRemoval[0].id,beforeRemoval[2].id]);
    assert.equal(await page.evaluate(()=>InkSimulation.time),0,'Removing an ink restarts the setup');
    assert.deepEqual(await page.locator('#ink-select option').allTextContents(),['Ink 1','Ink 2']);
    await page.locator('#add-ink').click();
    const afterAdd=await page.evaluate(()=>InkSimulation.settings.inks);
    assert(!beforeRemoval.some(ink=>ink.id===afterAdd[2].id),'New species never reuse an existing or removed identity');

    // Save v5 settings through the real UI, then restore the exact saved configuration.
    await page.locator('#domain').selectOption('sphere');
    await page.locator('#angle').fill('175');
    const saved=await page.evaluate(()=>window.savedInkSnapshots.at(-1));
    assert.equal(saved.modelContent.modelVersion,5);
    assert.deepEqual(saved.modelContent.inks,afterAdd);
    assert.equal(saved.modelContent.activeInkIndex,2);
    assert.equal(saved.modelContent.domain,'sphere');
    assert.equal(saved.modelContent.viewAngleDegrees,175);
    await page.locator('#remove-ink').click();
    const restored=await page.evaluate(saved=>{InkSimulation.restoreSettings(saved.modelContent);return InkSimulation.settings;},saved);
    assert.deepEqual(restored.inks,saved.modelContent.inks,'v5 round trip preserves IDs, density, and exact colours');
    assert.equal(restored.activeInkIndex,saved.modelContent.activeInkIndex);
    assert.equal(restored.domain,'sphere');
    assert.equal(restored.viewAngleDegrees,175);
    assert.equal(await page.locator('#ink-select').inputValue(),'2');

    const excessive=await page.evaluate(()=>InkSimulation.restoreSettings({inks:Array.from({length:16},(_,i)=>({id:i+1,density:.04,colour:'#3657b2'})),activeInkIndex:15}));
    assert.equal(excessive.inks.length,3,'Older saved configurations obey the reduced ink limit');
    assert.equal(excessive.activeInkIndex,2,'Restoring an excess selection stays inside the retained inks');
    assert.equal(await page.locator('#add-ink').isDisabled(),true);

    const legacy3={modelVersion:3,densityContrastPercent:.11,densityContrastPercent2:-.03,secondInk:true,inkColour:'blue',inkColour2:'amber',initialMotion:'still',boundary:'periodic',containerShape:'cuboid',seed:101,playbackSpeed:.75,viewAngleDegrees:60,quality:'standard'};
    const migrated3=await page.evaluate(state=>{InkSimulation.restoreSettings(state);return InkSimulation.settings;},legacy3);
    assert.equal(migrated3.modelVersion,5);
    assert.deepEqual(migrated3.inks.map(ink=>({density:ink.density,colour:ink.colour})),[{density:.11,colour:'#3657b2'},{density:-.03,colour:'#c1681c'}]);
    assert.equal(migrated3.currentStrength,0,'v3 still-water setting migrates to zero currents');
    assert.equal(migrated3.domain,'periodic');
    assert.equal(migrated3.seed,101);
    const legacy4={modelVersion:4,densityContrastPercent:-.02,secondInk:false,inkColour:'red',currentStrength:.5,boundary:'container',containerShape:'cylinder',seed:202,playbackSpeed:1.25,viewAngleDegrees:-45,quality:'standard'};
    const migrated4=await page.evaluate(state=>{InkSimulation.restoreSettings(state);return InkSimulation.settings;},legacy4);
    assert.deepEqual(migrated4.inks.map(ink=>({density:ink.density,colour:ink.colour})),[{density:-.02,colour:'#b93326'}]);
    assert.equal(migrated4.domain,'cylinder');
    assert.equal(migrated4.currentStrength,.5);
    assert.equal(migrated4.playbackSpeed,1.25);
    assert.equal(migrated4.viewAngleDegrees,-45);
    assert.equal(await page.locator('#remove-ink').isDisabled(),true);
    assert.deepEqual(errors,[]);
    const report={firstSeed,newSeed,first,second,third,rates,editor:{beforeRemoval,afterRemoval,afterAdd},saved,restored,migrated3,migrated4,errors};
    fs.mkdirSync('qa',{recursive:true});fs.writeFileSync('qa/controls.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify({reproducible:true,randomDefault:true,multiInkEditor:true,savedVersion:5,migrations:[3,4],rates,errors},null,2));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
