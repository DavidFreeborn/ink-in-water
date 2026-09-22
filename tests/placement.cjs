// Geometric guarantees for the production placement, including the coarsest
// regression grid's smoothed drop support and conservative voxel wall.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const source=fs.readFileSync(process.env.INK_SOURCE||'ink.js','utf8');
const match=source.match(/function chooseDropCentres\(\)\{[\s\S]*?\n  \}/);
assert(match,'Production placement function found');
const choose=new Function('inks','experimentSeed','containerShape','boundary',match[0]+';return chooseDropCentres();');
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const sphereCentre=[.04,.06,.04],h=.08/32;
const support=.0065*1.13+.8*h;
const report=[];
for(let count=1;count<=5;count++){
  const inks=Array.from({length:count},(_,i)=>({id:i+1}));
  const centres=choose(inks,125,'cuboid','container');
  assert.equal(centres.length,count);
  for(const seed of [0,1,125,4718593,4294967295])for(const domain of ['cuboid','cylinder','sphere','periodic']){
    assert.deepEqual(choose(inks,seed,domain,domain==='periodic'?'periodic':'container'),centres,'Changing seed or domain preserves the deliberate layout');
  }
  let minimumDistance=Infinity,minimumProjectedDistance=Infinity,minimumWallMargin=Infinity;
  for(let i=0;i<count;i++){
    const c=centres[i];
    assert(c.length===3&&c.every(Number.isFinite));
    // A point's cell centre can be half a voxel diagonal away, and the
    // retained-cell test includes another half diagonal to the outer corner.
    const sphereMargin=.04-distance(c,sphereCentre)-support-Math.sqrt(3)*h;
    minimumWallMargin=Math.min(minimumWallMargin,sphereMargin);
    assert(sphereMargin>.001,'Entire drop support fits the spherical voxel mask with a margin');
    assert(.04-Math.hypot(c[0]-.04,c[2]-.04)-support-Math.sqrt(2)*h>.001,'Cylinder radial margin');
    for(let axis=0;axis<3;axis++){
      const size=axis===1?.12:.08;
      assert(Math.min(c[axis],size-c[axis])-support-h>.001,'Cuboid wall margin');
    }
    for(let j=0;j<i;j++){
      const d=distance(c,centres[j]);
      // Projection at the production default angle: right=(1,0,0),
      // up=(0,.9928,.12). Every view cannot avoid overlap in three dimensions.
      const screen=Math.hypot(c[0]-centres[j][0],.9928*(c[1]-centres[j][1])+.12*(c[2]-centres[j][2]));
      minimumDistance=Math.min(minimumDistance,d);
      minimumProjectedDistance=Math.min(minimumProjectedDistance,screen);
      assert(d>=.024-1e-12,'Drop centres are separated by at least 24 mm');
      assert(screen>=.024-1e-12,'Initial view has at least 24 mm of projected centre separation');
      assert(screen-2*support>.005,'Smoothed initial drops have a visible projected gap even at grid 32');
    }
  }
  if(count===1)assert.deepEqual(centres,[[.04,.08,.04]],'Original single-drop position retained');
  if(count===2)assert.deepEqual(centres,[[.028,.08,.04],[.052,.08,.04]],'Original two-drop positions retained');
  if(count>=3)for(let axis=0;axis<3;axis++)assert(Math.abs(centres.reduce((sum,c)=>sum+c[axis],0)/count-[.04,.062,.04][axis])<1e-12,'Layout is balanced around the intended centre');
  report.push({count,centres,minimumDistance:count>1?minimumDistance:null,minimumProjectedDistance:count>1?minimumProjectedDistance:null,minimumWallMargin});
}
fs.mkdirSync('qa',{recursive:true});
fs.writeFileSync('qa/placement.json',JSON.stringify(report,null,2));
console.log('Placement: counts 1–5, five seeds, four domains; separation and wall margins PASS.');
