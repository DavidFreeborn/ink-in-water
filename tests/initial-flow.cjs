// Initial-current regression against production velocity interpolation, pressure
// projection and tracer advection. Correlations describe this experiment; they
// are not required to be small for every random seed or neighbouring position.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const source=fs.readFileSync(process.env.INK_SOURCE||'ink.js','utf8');
const baselinePath=process.env.INK_FLOW_BASELINE||'qa/ink-v12-baseline.js';
const baselineOnly=process.argv.includes('--baseline-only');
const seeds=[125,4718593,20260922];
const grid=Number(process.env.INK_FLOW_GRID||48);
const probeShader=`void main(){vec3 p=texelFetch(b,ivec2(gl_FragCoord.xy),0).xyz;outColor=vec4(vel(a,p/h+.5),1);}`;

function instrument(code){
  const hook=String.raw`
  qaFlowConfigure(options={}){
    running=false;boundary=options.domain==='periodic'?'periodic':'container';containerShape=options.domain==='periodic'?'cuboid':options.domain||'cuboid';
    currentStrength=options.strength??1;initialMotion=currentStrength?'gentle':'still';
    inks=Array.from({length:options.count||5},(_,i)=>({id:i+1,density:0,colour:DEFAULT_COLOUR}));activeInkIndex=0;nextInkId=inks.length+1;
    chooseSeed(options.seed??125);allocate(quality);
  },
  qaFlowProbe(points){
    if(!programs.qaFlowProbe)program('qaFlowProbe',PROBE_SHADER);
    const g={n:[points.length,1,1],columns:1,h},input=field(g,4),output=field(g,4);
    const data=new Float32Array(points.flatMap(p=>[...p,1]));
    gl.bindTexture(gl.TEXTURE_2D,input.tex);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,points.length,1,gl.RGBA,gl.FLOAT,data);invalidateRenderState();
    draw('qaFlowProbe',output,{a:velocity[0],b:input},{n:dims.n,columns:dims.columns,h});
    const result=Array.from(read(output)).filter((_,i)=>i%4!==3);
    discardField(input);discardField(output);invalidateRenderState();return result;
  },
  async qaFlowSnapshot(){
    const raw=read(velocity[0]),mask=read(levels[0].geometry),N=dims.active,[nx,ny]=dims.n,columns=dims.columns,width=velocity[0].width;
    const offset=q=>((Math.floor(q[2]/columns)*ny+q[1])*width+(q[2]%columns)*nx+q[0])*4;
    let count=0,speedSquared=0,ghostError=0,wallFluxMaximum=0;const mean=[0,0,0];
    for(let z=1;z<=N[2];z++)for(let y=1;y<=N[1];y++)for(let x=1;x<=N[0];x++){
      const q=[x,y,z],i=offset(q);if(boundary!=='periodic'&&containerShape!=='cuboid'&&mask[i+3]<.5)continue;
      count++;for(let axis=0;axis<3;axis++){const p=q.slice();p[axis]--;const value=.5*(raw[i+axis]+raw[offset(p)+axis]);mean[axis]+=value;speedSquared+=value*value;}
    }
    for(let z=0;z<=N[2]+1;z++)for(let y=0;y<=N[1]+1;y++)for(let x=0;x<=N[0]+1;x++){
      const q=[x,y,z],i=offset(q),inside=q.every((v,j)=>v>=1&&v<=N[j]);
      if(boundary==='periodic'&&!inside){const p=q.map((v,j)=>((v-1)%N[j]+N[j])%N[j]+1);for(let a=0;a<3;a++)ghostError=Math.max(ghostError,Math.abs(raw[i+a]-raw[offset(p)+a]));}
      if(boundary!=='periodic')for(let a=0;a<3;a++)if(q[a]===0||q[a]===N[a])wallFluxMaximum=Math.max(wallFluxMaximum,Math.abs(raw[i+a]));
    }
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw.buffer))).map(x=>x.toString(16).padStart(2,'0')).join('');
    return{seed:experimentSeed,domain:domainValue(),centres:dropCentres.map(p=>p.slice()),h,rmsSpeed:Math.sqrt(speedSquared/count),specificKineticEnergy:.5*speedSquared/count,meanVelocity:mean.map(x=>x/count),ghostError,wallFluxMaximum,velocityHash:digest};
  },
  qaFlowTransportProbe(points){
    if(!particleRendering)throw Error('Tracer renderer is needed for the production transport probe');
    const g={n:[points.length,1,1],columns:1,h},input=field(g,4),ids=field(g),output=field(g,4),stillOutput=field(g,4),zeroVelocity=field(dims,4);
    const data=new Float32Array(points.flatMap(p=>[...p,1])),numbers=Float32Array.from(points,(_,i)=>i);
    gl.bindTexture(gl.TEXTURE_2D,input.tex);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,points.length,1,gl.RGBA,gl.FLOAT,data);
    gl.bindTexture(gl.TEXTURE_2D,ids.tex);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,points.length,1,gl.RED,gl.FLOAT,numbers);invalidateRenderState();clear(zeroVelocity);
    const perKey=[];
    for(let inkKey=0;inkKey<inks.length;inkKey++){
      draw('advectParticles',output,{a:velocity[0],b:input,ids},{n:dims.n,columns:dims.columns,h,stepIndex:0,inkKey});
      draw('advectParticles',stillOutput,{a:zeroVelocity,b:input,ids},{n:dims.n,columns:dims.columns,h,stepIndex:0,inkKey});
      const moving=read(output),still=read(stillOutput),deterministic=[];
      for(let i=0;i<points.length;i++)for(let a=0;a<3;a++)deterministic.push(moving[4*i+a]-still[4*i+a]);
      perKey.push(deterministic);
    }
    for(const f of [input,ids,output,stillOutput,zeroVelocity])discardField(f);invalidateRenderState();
    return perKey;
  },
  qaFlowTracerMoments(){return tracerSets.map(set=>{
    const data=read(set.particles[0]),mean=[0,0,0],second=Array(9).fill(0);let mass=0;
    for(let i=0;i<set.count;i++){const k=4*i,w=data[k+3];mass+=w;for(let a=0;a<3;a++)mean[a]+=w*data[k+a];}
    for(let a=0;a<3;a++)mean[a]/=mass;
    for(let i=0;i<set.count;i++){const k=4*i,w=data[k+3];for(let a=0;a<3;a++)for(let b=0;b<3;b++)second[3*a+b]+=w*(data[k+a]-mean[a])*(data[k+b]-mean[b]);}
    return{id:set.id,mass,centroid:mean,covariance:second.map(x=>x/mass)};
  });},`;
  assert(code.includes('window.InkSimulation={'),'Production diagnostics hook found');
  const result=code.replace('window.InkSimulation={','window.InkSimulation={'+hook.replace('PROBE_SHADER',JSON.stringify(probeShader)));
  new Function(result);return result;
}

const norm=a=>Math.hypot(...a);
const mean=a=>a.reduce((sum,x)=>sum+x,0)/a.length;
function similarity(a,b){
  assert.equal(a.length,b.length);let aa=0,bb=0,ab=0,difference=0,maximum=0;
  for(let i=0;i<a.length;i++){aa+=a[i]*a[i];bb+=b[i]*b[i];ab+=a[i]*b[i];difference+=(a[i]-b[i])**2;maximum=Math.max(maximum,Math.abs(a[i]-b[i]));}
  return{cosine:aa*bb>0?ab/Math.sqrt(aa*bb):null,relativeRmsDifference:aa+bb>0?Math.sqrt(2*difference/(aa+bb)):0,maximumDifference:maximum};
}
const localOffsets=[[0,0,0],...Array.from({length:32},(_,i)=>{
  const y=1-2*(i+.5)/32,angle=i*2.399963229728653,r=Math.sqrt(1-y*y);
  return [.0045*r*Math.cos(angle),.0045*y,.0045*r*Math.sin(angle)];
})];
const add=(a,b)=>a.map((x,i)=>x+b[i]);

async function localFlow(page,centres,h){
  const epsilon=h/2,points=[];
  for(const centre of centres)for(const offset of localOffsets){
    const p=add(centre,offset);points.push(p);
    for(let axis=0;axis<3;axis++)for(const sign of [-1,1])points.push(p.map((x,a)=>x+(a===axis?sign*epsilon:0)));
  }
  const velocities=await page.evaluate(points=>InkSimulation.qaFlowProbe(points),points);
  let cursor=0;const drops=[];
  for(const centre of centres){
    const v=[],gradients=[],strains=[];
    for(const offset of localOffsets){
      v.push(...velocities.slice(cursor,cursor+3));cursor+=3;const gradient=Array(9);
      for(let axis=0;axis<3;axis++){
        const minus=velocities.slice(cursor,cursor+3),plus=velocities.slice(cursor+3,cursor+6);cursor+=6;
        for(let component=0;component<3;component++)gradient[component*3+axis]=(plus[component]-minus[component])/(2*epsilon);
      }
      gradients.push(...gradient);
      for(let a=0;a<3;a++)for(let b=0;b<3;b++)strains.push(.5*(gradient[a*3+b]+gradient[b*3+a]));
    }
    const meanVelocity=[0,1,2].map(a=>mean(v.filter((_,i)=>i%3===a))),centred=v.map((x,i)=>x-meanVelocity[i%3]);
    drops.push({centre,centreVelocity:v.slice(0,3),meanVelocity,centredVelocity:centred,gradients,strains,gradientRms:Math.sqrt(mean(gradients.map(x=>x*x))),strainRms:Math.sqrt(mean(strains.map(x=>x*x)))});
  }
  const pairs=[];
  for(let i=0;i<drops.length;i++)for(let j=i+1;j<drops.length;j++)pairs.push({inks:[i+1,j+1],centreDistance:norm(centres[i].map((x,a)=>x-centres[j][a])),translationVelocityDifference:norm(drops[i].meanVelocity.map((x,a)=>x-drops[j].meanVelocity[a])),centredVelocity:similarity(drops[i].centredVelocity,drops[j].centredVelocity),gradient:similarity(drops[i].gradients,drops[j].gradients),strain:similarity(drops[i].strains,drops[j].strains)});
  return{drops,pairs};
}

async function translationChecks(page,h){
  // Fixed probes isolate the flow change from changed drop placement. The
  // historical ABC field repeats after 20 mm along every coordinate axis.
  const base=Array.from({length:48},(_,i)=>[.017+.0011*(i%8),.047+.0013*(Math.floor(i/8)%6),.026+.0009*((i*7)%11)]);
  const result=[];
  for(const distance of [.018,.020])for(let axis=0;axis<3;axis++){
    const shifted=base.map(p=>p.map((x,a)=>x+(a===axis?distance:0)));
    const local=await localFlow(page,[base[0],shifted[0]],h);
    const values=await page.evaluate(points=>InkSimulation.qaFlowProbe(points),[...base,...shifted]);
    result.push({distance,axis,velocity:similarity(values.slice(0,base.length*3),values.slice(base.length*3)),localStrain:local.pairs[0].strain});
  }
  return result;
}

async function seamCheck(page){
  const points=[];
  for(let axis=0;axis<3;axis++)for(let i=0;i<16;i++){
    const p=[.013+.002*i,.032+.003*i,.014+.0017*i],length=[.08,.12,.08][axis];
    p[axis]=0;points.push(p.slice());p[axis]=length;points.push(p.slice());
  }
  const v=await page.evaluate(points=>InkSimulation.qaFlowProbe(points),points);let maximum=0;
  for(let i=0;i<v.length;i+=6)for(let a=0;a<3;a++)maximum=Math.max(maximum,Math.abs(v[i+a]-v[i+3+a]));
  return maximum;
}

function brief(run){
  return{seed:run.snapshot.seed,domain:run.snapshot.domain,count:run.snapshot.centres.length,rmsSpeed:run.snapshot.rmsSpeed,specificKineticEnergy:run.snapshot.specificKineticEnergy,divergence:run.diagnostics.divergenceAfter,
    meanAbsolutePairStrainCosine:mean(run.local.pairs.map(p=>Math.abs(p.strain.cosine))),
    pairStrainCosines:run.local.pairs.map(p=>p.strain.cosine),translation20mm:run.translations?.filter(x=>x.distance===.020).map(x=>({axis:x.axis,relativeVelocityDifference:x.velocity.relativeRmsDifference,strainCosine:x.localStrain.cosine}))};
}

(async()=>{
  const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11']});const errors=[];
  async function open(code){
    const page=await browser.newPage({viewport:{width:900,height:900}});await page.emulateMedia({reducedMotion:'reduce'});
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/ink.js',route=>route.fulfill({body:instrument(code),contentType:'application/javascript'}));
    await page.goto('http://127.0.0.1:8765/?grid='+grid);await page.waitForFunction(()=>window.InkSimulation);return page;
  }
  async function capture(page,options,extended=false){
    await page.evaluate(options=>InkSimulation.qaFlowConfigure(options),options);
    const snapshot=await page.evaluate(()=>InkSimulation.qaFlowSnapshot());
    const local=await localFlow(page,snapshot.centres,snapshot.h);
    const diagnostics=await page.evaluate(()=>InkSimulation.diagnostics());
    const run={snapshot,local,diagnostics};
    assert.equal(diagnostics.glError,0);assert(diagnostics.finite,'Initial projected fields are finite');
    assert(diagnostics.divergenceAfter<3e-5,'Initial MAC divergence RMS is small: '+diagnostics.divergenceAfter);
    assert.equal(snapshot.ghostError,0,'Periodic MAC ghost faces are exact copies');assert.equal(snapshot.wallFluxMaximum,0,'Outer wall normal flux vanishes');
    if(options.strength!==0)assert(snapshot.rmsSpeed>0,'Nonzero initial current');
    if(extended){run.translations=await translationChecks(page,snapshot.h);run.periodicSeamError=await seamCheck(page);assert(run.periodicSeamError<1e-7,'Periodic interpolation agrees at both ends of the cell');}
    return run;
  }
  try{
    const report={grid,seeds,units:{length:'m',velocity:'m/s',gradient:'1/s',specificKineticEnergy:'m²/s²'},baseline:[],current:[],errors};
    if(fs.existsSync(baselinePath)){
      const page=await open(fs.readFileSync(baselinePath,'utf8'));
      for(const seed of seeds){
        const run=await capture(page,{domain:'periodic',seed,count:5},true);
        // Historical interpolation at a finite grid can differ under a shift
        // not equal to an integer number of cells. Grid48 has exactly12 cells
        // per20mm and therefore reproduces the old sub-domain symmetry.
        if(grid%4===0)for(const p of run.translations.filter(p=>p.distance===.020))assert(p.velocity.relativeRmsDifference<2e-5,'The old 20 mm repeat is reproduced');
        report.baseline.push(run);console.log('Historical current seed '+seed+' measured.');
      }
      await page.close();
    }
    if(!baselineOnly){
      const page=await open(source);
      for(const seed of seeds){
        const run=await capture(page,{domain:'periodic',seed,count:5},true);
        for(const p of run.translations.filter(p=>p.distance===.020))assert(p.velocity.relativeRmsDifference>1e-3,'No exact historical 20 mm velocity repeat remains');
        if(seed===seeds[0]){
          const before=run.snapshot.velocityHash;await page.evaluate(()=>InkSimulation.reset());
          const repeated=await page.evaluate(()=>InkSimulation.qaFlowSnapshot());assert.equal(repeated.velocityHash,before,'Reset reproduces the initial velocity bit for bit');run.resetExact=true;
          const points=run.snapshot.centres.flatMap(c=>localOffsets.map(p=>add(c,p)));
          const perKey=await page.evaluate(points=>InkSimulation.qaFlowTransportProbe(points),points);
          const deviations=perKey.map(p=>similarity(perKey[0],p).maximumDifference);
          assert(Math.max(...deviations)<3e-8,'Ink identity changes diffusion samples, not transport by the shared velocity');
          run.transport={maximumIdentityDeviation:Math.max(...deviations),firstKeyDisplacements:perKey[0]};
          const initial=await page.evaluate(()=>InkSimulation.qaFlowTracerMoments());await page.evaluate(()=>InkSimulation.step(50));
          const after=await page.evaluate(()=>InkSimulation.qaFlowTracerMoments()),flow=await page.evaluate(()=>InkSimulation.diagnostics());
          assert(flow.finite&&flow.glError===0);for(let i=0;i<initial.length;i++)assert.equal(after[i].mass,initial[i].mass,'Each actual tracer set preserves its own weight');
          run.earlyMotion={duration:flow.time,initial,after,centroidDisplacements:after.map((item,i)=>item.centroid.map((x,a)=>x-initial[i].centroid[a])),flow};
        }
        report.current.push(run);console.log('Revised current seed '+seed+' measured.');
      }
      assert.equal(new Set(report.current.map(x=>x.snapshot.velocityHash)).size,seeds.length,'Different seeds select different velocity fields');
      report.domains=[];
      for(const domain of ['cuboid','cylinder','sphere']){
        const run=await capture(page,{domain,seed:seeds[0],count:5});report.domains.push(run);console.log(domain+' initial projection measured.');
      }
      report.counts=[];
      for(const count of [2,3,4])report.counts.push(await capture(page,{domain:'cuboid',seed:seeds[0],count}));
      const neutral=await capture(page,{domain:'cuboid',seed:seeds[0],count:5,strength:0});
      assert.equal(neutral.snapshot.rmsSpeed,0);await page.evaluate(()=>InkSimulation.step(20));
      neutral.after=await page.evaluate(()=>InkSimulation.diagnostics());assert.equal(neutral.after.maxSpeed,0,'Neutral ink at zero current leaves water exactly at rest');report.neutral=neutral;
      await page.close();
    }
    assert.deepEqual(errors,[]);fs.mkdirSync('qa',{recursive:true});
    const output='qa/initial-flow'+(baselineOnly?'-baseline':'-validation')+'.json';fs.writeFileSync(output,JSON.stringify(report,null,2));
    console.log(JSON.stringify({baseline:report.baseline.map(brief),current:report.current.map(brief),domains:report.domains?.map(brief),neutralMaxSpeed:report.neutral?.after.maxSpeed,errors,output},null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
