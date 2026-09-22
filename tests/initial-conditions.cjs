// Initial-shape regression. The probe calls the production initialDrop function;
// it never replaces the seeding, transport, or force shaders.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const source = fs.readFileSync(process.env.INK_SOURCE || 'ink.js', 'utf8');
const baselinePath = process.env.INK_INITIAL_BASELINE || 'qa/ink-count-baseline.js';
const seed = 4718593;
const inkIds = [1, 7, 29];

function instrument(code) {
  const current = code.includes('float initialDrop(');
  const shader = `
    uniform vec2 testPhases,legacyPhases;
    uniform vec4 testOrientation;
    uniform vec3 testCentre;
    uniform float gridSampleCount;
    float legacyDrop(vec3 p,vec2 phases){
      float r=.0065*(1.+.13*sin(atan(p.z,p.x)*5.+phases.x)*sin(atan(length(p.xz),p.y)*3.+phases.y));
      return 1.-smoothstep(r-.8*h,r+.8*h,length(p));
    }
    void main(){
      vec4 point=texelFetch(a,ivec2(gl_FragCoord.xy),0);
      if(gl_FragCoord.x<gridSampleCount)point.xyz=(point.xyz-.5)*h-testCentre;
      float value=${current ? 'initialDrop(point.xyz,testPhases,testOrientation)' : 'legacyDrop(point.xyz,testPhases)'};
      outColor=vec4(value,point.w,abs(value-point.w),legacyDrop(point.xyz,legacyPhases));
    }`;
  const hook = `async qaInitialSnapshot(){
    const digest=async array=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',array.buffer))).map(x=>x.toString(16).padStart(2,'0')).join('');
    const shapeFor=id=>typeof initialShapeForInk==='function'?initialShapeForInk(id):{phases:shapePhase.slice(),orientation:[0,0,0,1]};
    if(!programs.qaInitialLaw)program('qaInitialLaw',${JSON.stringify(shader)});
    const gridData=scalarGroups.map(group=>read(group.dye[0]));
    const gridHashes=await Promise.all(gridData.map(digest));
    const radius=.0065,spacing=.018/particleSide,perInk=[];
    const moments=()=>({mass:0,first:[0,0,0],second:Array(9).fill(0)});
    const add=(m,p,weight)=>{m.mass+=weight;for(let a=0;a<3;a++){m.first[a]+=weight*p[a]/radius;for(let b=0;b<3;b++)m.second[3*a+b]+=weight*p[a]*p[b]/(radius*radius);}};
    const finish=m=>({mass:m.mass,first:m.first.map(x=>x/m.mass),second:m.second.map(x=>x/m.mass)});
    for(let index=0;index<inks.length;index++){
      const ink=inks[index],shape=shapeFor(ink.id),centre=dropCentres[index],channel=index%4;
      const raw=gridData[Math.floor(index/4)],fieldState=scalarGroups[Math.floor(index/4)].dye[0];
      const gridMoment=moments(),tracerMoment=moments(),gridSamples=[],tracerSamples=[];
      const [nx,ny,nz]=dims.n;
      for(let z=1;z<nz-1;z++)for(let y=1;y<ny-1;y++)for(let x=1;x<nx-1;x++){
        const offset=((Math.floor(z/dims.columns)*ny+y)*fieldState.width+(z%dims.columns)*nx+x)*4;
        const concentration=raw[offset+channel];if(concentration<=0)continue;
        const p=[(x-.5)*h-centre[0],(y-.5)*h-centre[1],(z-.5)*h-centre[2]];
        add(gridMoment,p,concentration*h**3);
        if(gridSamples.length<384&&concentration>.001&&concentration<.999)gridSamples.push([x,y,z,concentration]);
      }
      const set=tracerSets[index],tracers=read(set.particles[0]),weights=new Float32Array(set.count);
      for(let j=0;j<set.count;j++){
        const offset=j*4,weight=tracers[offset+3],p=[tracers[offset]-centre[0],tracers[offset+1]-centre[1],tracers[offset+2]-centre[2]];
        weights[j]=weight;add(tracerMoment,p,weight);
        const concentration=weight/spacing**3;
        if(tracerSamples.length<384&&concentration>.001&&concentration<.999)tracerSamples.push([...p,concentration]);
      }
      // Equal local shell coordinates remove the different drop centres. The
      // old shared phases therefore produce exactly coincident shape profiles.
      const shell=[];
      for(let j=0;j<512;j++){
        const y=1-2*(j+.5)/512,azimuth=j*2.399963229728653,r=Math.sqrt(1-y*y);
        shell.push([radius*r*Math.cos(azimuth),radius*y,radius*r*Math.sin(azimuth),0]);
      }
      const samples=[...gridSamples,...tracerSamples,...shell],g={n:[samples.length,1,1],columns:1,h};
      const input=field(g,4),output=field(g,4),points=new Float32Array(samples.flat());
      gl.bindTexture(gl.TEXTURE_2D,input.tex);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,samples.length,1,gl.RGBA,gl.FLOAT,points);invalidateRenderState();
      draw('qaInitialLaw',output,{a:input},{h,testPhases:shape.phases,testOrientation:shape.orientation,legacyPhases:shapePhase,testCentre:centre,gridSampleCount:gridSamples.length});
      const probe=read(output),profile=[],legacyProfile=[];
      let gridLawError=0,tracerLawError=0,legacyLawError=0;
      for(let j=0;j<gridSamples.length;j++)gridLawError=Math.max(gridLawError,probe[4*j+2]);
      for(let j=gridSamples.length;j<gridSamples.length+tracerSamples.length;j++)tracerLawError=Math.max(tracerLawError,probe[4*j+2]);
      for(let j=gridSamples.length+tracerSamples.length;j<samples.length;j++){
        profile.push(probe[4*j]);legacyProfile.push(probe[4*j+3]);legacyLawError=Math.max(legacyLawError,Math.abs(probe[4*j]-probe[4*j+3]));
      }
      perInk.push({id:ink.id,shape,centre:centre.slice(),grid:finish(gridMoment),tracers:finish(tracerMoment),count:set.count,
        gridSamples:gridSamples.length,tracerSamples:tracerSamples.length,gridLawError,tracerLawError,legacyLawError,
        profile,legacyProfile,tracerHash:await digest(tracers),weightHash:await digest(weights)});
      discardField(input);discardField(output);invalidateRenderState();
    }
    render();return{seed:experimentSeed,grid:dims.active.slice(),h,time:simTime,gridHashes,perInk,glError:gl.getError()};
  },`;
  assert(code.includes('window.InkSimulation={'), 'Production diagnostics hook found');
  const result=code.replace('window.InkSimulation={','window.InkSimulation={'+hook);
  new Function(result);
  return result;
}

function compareProfiles(left,right) {
  const mean=a=>a.reduce((sum,x)=>sum+x,0)/a.length;
  const a=mean(left),b=mean(right);let covariance=0,v1=0,v2=0,squared=0,maximum=0;
  for(let i=0;i<left.length;i++){
    const x=left[i]-a,y=right[i]-b,d=left[i]-right[i];
    covariance+=x*y;v1+=x*x;v2+=y*y;squared+=d*d;maximum=Math.max(maximum,Math.abs(d));
  }
  return{rms:Math.sqrt(squared/left.length),maximum,correlation:covariance/Math.sqrt(v1*v2)};
}

function validateLaw(snapshot) {
  assert.equal(snapshot.glError,0);
  for(const ink of snapshot.perInk){
    assert(ink.gridSamples>32&&ink.tracerSamples>32,'Nontrivial transition samples for ink '+ink.id);
    // Positions reconstructed from stored float32 coordinates introduce a few
    // nanometres of roundoff; the tolerance is in dimensionless concentration.
    assert(ink.gridLawError<5e-5,'Grid uses the production shape law for ink '+ink.id+': '+ink.gridLawError);
    assert(ink.tracerLawError<5e-5,'Tracers use the production shape law for ink '+ink.id+': '+ink.tracerLawError);
    assert(Math.abs(ink.grid.mass/ink.tracers.mass-1)<.03,'Grid/tracer initial amounts agree within 3% at the test resolution');
    const a=[...ink.grid.first,...ink.grid.second],b=[...ink.tracers.first,...ink.tracers.second];
    assert(Math.max(...a.map((value,i)=>Math.abs(value-b[i])))<.02,'Centred grid/tracer moments agree within 0.02 in radius-normalised units');
  }
}

function seedUnit(value){value=Math.imul(value^(value>>>16),0x7feb352d);value=Math.imul(value^(value>>>15),0x846ca68b);return((value^(value>>>16))>>>0)/4294967296;}

(async()=>{
  const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11']});
  const errors=[];
  async function open(code){
    const page=await browser.newPage({viewport:{width:900,height:900}});
    await page.emulateMedia({reducedMotion:'reduce'});
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/ink.js',route=>route.fulfill({body:instrument(code),contentType:'application/javascript'}));
    await page.goto('http://127.0.0.1:8765/?grid=80');
    await page.waitForFunction(()=>window.InkSimulation);
    return page;
  }
  async function configure(page,ids){
    await page.evaluate(({ids,seed})=>InkSimulation.restoreSettings({inks:ids.map(id=>({id,density:0,colour:'#3657b2'})),seed,currentStrength:0,domain:'cuboid',quality:'standard',activeInkIndex:0}),{ids,seed});
    return page.evaluate(()=>InkSimulation.qaInitialSnapshot());
  }
  try{
    let baseline=null;
    if(fs.existsSync(baselinePath)){
      const page=await open(fs.readFileSync(baselinePath,'utf8'));
      const single=await configure(page,[1]),multiple=await configure(page,inkIds);
      const pair=compareProfiles(multiple.perInk[0].profile,multiple.perInk[1].profile);
      assert.equal(pair.maximum,0,'Historical shared phases produce identical centred shapes');
      baseline={single,multiple,pair};await page.close();
      console.log('Historical shared-phase equality reproduced.');
    }
    const page=await open(source),single=await configure(page,[1]);validateLaw(single);
    assert.deepEqual(single.perInk[0].shape,{phases:[0xa511e9b3,0x63d83595].map(salt=>2*Math.PI*seedUnit(seed^salt)),orientation:[0,0,0,1]},'Ink 1 retains its original seed phases and orientation');
    assert(single.perInk[0].legacyLawError<1e-6,'Ink 1 preserves the original concentration law');
    if(baseline){
      assert.deepEqual(single.gridHashes,baseline.single.gridHashes,'Default ink grid is bit-identical to the frozen baseline');
      assert.equal(single.perInk[0].tracerHash,baseline.single.perInk[0].tracerHash,'Default ink tracer positions and weights are bit-identical');
    }
    const multiple=await configure(page,inkIds);validateLaw(multiple);
    const pairs=[];
    for(let i=0;i<multiple.perInk.length;i++)for(let j=i+1;j<multiple.perInk.length;j++){
      const pair={ids:[multiple.perInk[i].id,multiple.perInk[j].id],...compareProfiles(multiple.perInk[i].profile,multiple.perInk[j].profile)};
      assert(pair.maximum>.08&&pair.rms>.015&&Math.abs(pair.correlation)<.98,'Different identities have distinct centred shell profiles');pairs.push(pair);
      assert.equal(compareProfiles(multiple.perInk[i].legacyProfile,multiple.perInk[j].legacyProfile).maximum,0,'The former common-phase law has no per-ink shape variation');
    }
    assert.equal(multiple.perInk[0].weightHash,single.perInk[0].weightHash,'Adding inks preserves ink 1 quadrature weights');
    for(const ink of multiple.perInk)assert(Math.abs(ink.shape.orientation.reduce((sum,x)=>sum+x*x,0)-1)<1e-12,'Initial orientations are unit quaternions');
    await page.evaluate(()=>InkSimulation.reset());
    const repeat=await page.evaluate(()=>InkSimulation.qaInitialSnapshot());
    assert.deepEqual(repeat,multiple,'Reset exactly reproduces shapes, sampled fields, tracers and moments');
    await page.evaluate(()=>InkSimulation.step(10));
    const neutral=await page.evaluate(()=>({flow:InkSimulation.diagnostics(),configuration:InkSimulation.configuration}));
    assert.equal(neutral.flow.maxSpeed,0,'Initial shape randomness adds no continuing force in neutral still water');
    assert.deepEqual(neutral.configuration.perInk.map(ink=>ink.initialShape),multiple.perInk.map(ink=>ink.shape),'Initial shape parameters remain fixed during evolution');
    assert.deepEqual(errors,[]);await page.close();
    const report={baseline:baseline?{path:baselinePath,pair:baseline.pair,defaultGridBitIdentity:true,defaultTracerBitIdentity:true}:null,single,multiple,pairs,resetExact:true,neutral,errors};
    fs.mkdirSync('qa',{recursive:true});fs.writeFileSync('qa/initial-conditions-validation.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify({baseline:report.baseline,pairs,resetExact:true,neutralMaxSpeed:neutral.flow.maxSpeed,perInk:multiple.perInk.map(({id,gridLawError,tracerLawError,grid,tracers})=>({id,gridLawError,tracerLawError,relativeAmountDifference:grid.mass/tracers.mass-1})),errors},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
