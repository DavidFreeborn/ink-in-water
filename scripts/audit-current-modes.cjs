// Read-only CPU audit of the actual production initial-current generator.
// It does not evaluate wall projection or subsequent fluid evolution.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const source=fs.readFileSync('ink.js','utf8');
const hash=source.slice(source.indexOf('  function seedUnit(value)'),source.indexOf('  const CURRENT_MODES'));
const catalog=source.slice(source.indexOf('  const CURRENT_MODES'),source.indexOf('  let experimentSeed='));
const chooser=source.slice(source.indexOf('  function chooseCurrentModes()'),source.indexOf('  function chooseSeed(value)'));
const generator=new Function(hash+catalog+'\nlet experimentSeed=0;\n'+chooser+'\nreturn {candidates:currentCandidates,count:CURRENT_MODES,modes(seed){experimentSeed=seed>>>0;return chooseCurrentModes();}};')();
const length=[.08,.12,.08],amplitude=.004*Math.sqrt(3/generator.count);
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0),norm=a=>Math.hypot(...a);
const gcd=(a,b)=>{a=Math.abs(a);b=Math.abs(b);while(b){const next=a%b;a=b;b=next;}return a;};
const determinant=(a,b,c)=>a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]);
const indices=m=>m.wave.map((v,i)=>Math.round(v*length[i]/(2*Math.PI)));
const stats=values=>{const sorted=values.slice().sort((a,b)=>a-b);return{minimum:sorted[0],p10:sorted[Math.floor(sorted.length*.1)],median:sorted[Math.floor(sorted.length*.5)],p90:sorted[Math.floor(sorted.length*.9)],maximum:sorted.at(-1),mean:sorted.reduce((a,b)=>a+b,0)/sorted.length};};
const grad=(point,modes)=>modes.reduce((result,m)=>{const factor=amplitude*Math.cos(dot(m.wave,point)+m.phase);for(let i=0;i<3;i++)for(let j=0;j<3;j++)result[3*i+j]+=factor*m.polarization[i]*m.wave[j];return result;},Array(9).fill(0));
const velocity=(point,modes)=>modes.reduce((result,m)=>{const factor=amplitude*Math.sin(dot(m.wave,point)+m.phase);for(let i=0;i<3;i++)result[i]+=factor*m.polarization[i];return result;},[0,0,0]);
const strain=g=>g.map((value,i)=>(value+g[(i%3)*3+Math.floor(i/3)])/2);
const correlation=(a,b)=>dot(a,b)/(norm(a)*norm(b));
assert.equal(new Set(generator.candidates.map(m=>m.id)).size,generator.candidates.length,'Unique hash IDs');
assert.equal(new Set(generator.candidates.map(m=>indices(m).join(','))).size,generator.candidates.length,'Unique wavevectors');
const rows=[],gradientRms=[],localGCorrelation=[],localSCorrelation=[],discreteDivergence={32:[],112:[],160:[]};
let maximumTransverseError=0,maximumNormError=0,maximumPeriodicityError=0;
for(let seed=0;seed<1000;seed++){
  const modes=generator.modes(seed),signed=new Set();
  assert.equal(modes.length,16);
  assert.deepEqual(modes,generator.modes(seed),'Same seed reproduces every mode');
  for(const mode of modes){
    const integer=indices(mode),first=integer.find(value=>value!==0);
    assert(first>0,'Canonical sign');
    const wavelength=2*Math.PI/norm(mode.wave);
    assert(wavelength>=.018-1e-14&&wavelength<=.030+1e-14,'Resolved wavelength band');
    assert(!signed.has(integer.join(',')),'No duplicate mode');signed.add(integer.join(','));
    maximumTransverseError=Math.max(maximumTransverseError,Math.abs(dot(mode.wave,mode.polarization))/norm(mode.wave));
    maximumNormError=Math.max(maximumNormError,Math.abs(norm(mode.polarization)-1));
  }
  const integers=modes.map(indices);let latticeIndex=0;
  for(let i=0;i<integers.length;i++)for(let j=i+1;j<integers.length;j++)for(let k=j+1;k<integers.length;k++)latticeIndex=gcd(latticeIndex,determinant(integers[i],integers[j],integers[k]));
  assert.equal(latticeIndex,1,'Representative field has no exact subcell translation');
  const p=[.01337,.04219,.03571],v=velocity(p,modes);
  for(let axis=0;axis<3;axis++){const q=p.slice();q[axis]+=length[axis];const w=velocity(q,modes);maximumPeriodicityError=Math.max(maximumPeriodicityError,...v.map((x,i)=>Math.abs(x-w[i])));}
  gradientRms.push(Math.sqrt(modes.reduce((sum,m)=>sum+amplitude*amplitude*dot(m.wave,m.wave)/2,0)));
  for(const [cells,values]of Object.entries(discreteDivergence)){
    const h=.08/Number(cells);
    values.push(Math.sqrt(modes.reduce((sum,m)=>{const symbol=m.wave.map(k=>2*Math.sin(.5*k*h)/h);return sum+amplitude*amplitude*dot(symbol,m.polarization)**2/2;},0)));
  }
  // 18 mm is the former lattice spacing. Coordinates match the new shader's
  // physical centre offset; this compares the analytic fields before projection.
  const g=grad([0,0,0],modes),h=grad([.018,0,0],modes);
  localGCorrelation.push(correlation(g,h));localSCorrelation.push(correlation(strain(g),strain(h)));
  if([0,1,125,4718593].includes(seed))rows.push({seed,latticeIndex,modes});
}
assert(maximumTransverseError<1e-14);
assert(maximumNormError<1e-14);
assert(maximumPeriodicityError<1e-14);
assert.notDeepEqual(generator.modes(0),generator.modes(1),'Changing seed changes the water');
// Full-domain orthogonality removes cross terms. A transverse unit mode
// contributes a^2/2 to both |u|^2 and |grad u|^2/k^2.
const exactRms=amplitude*Math.sqrt(generator.count/2);
assert(Math.abs(exactRms-.004*Math.sqrt(3/2))<1e-16);
const report={scope:'Production mode generator evaluated on CPU; unprojected analytic field only. No GPU or wall-projected statistics.',seeds:1000,catalogCount:generator.candidates.length,modes:generator.count,maximumTransverseError,maximumNormError,maximumPeriodicityError,exactVelocityRms:exactRms,oldGradientRms:.004*Math.sqrt(3/2)*100*Math.PI,newGradientRms:stats(gradientRms),old18mmGradientCorrelation:(2+Math.cos(.2*Math.PI))/3,new18mmLocalGradientCorrelation:stats(localGCorrelation),new18mmLocalStrainCorrelation:stats(localSCorrelation),discreteDivergenceRmsBeforeProjection:Object.fromEntries(Object.entries(discreteDivergence).map(([cells,values])=>[cells,stats(values)])),allRepresentativeLatticeIndices:1,examples:rows};
fs.mkdirSync('qa',{recursive:true});
fs.writeFileSync('qa/current-modes-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,examples:rows.map(({seed,latticeIndex})=>({seed,latticeIndex}))},null,2));
