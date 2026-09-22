// Run with the local HTTP server listening on 127.0.0.1:8765.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
fs.mkdirSync('qa',{recursive:true});
for(const name of ['brownian','boundaries','controls','fine-pressure','geometry','multi-inks','initial-conditions']) {
  const result=spawnSync(process.execPath,['tests/'+name+'.cjs'],{cwd:__dirname,stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status||1);
}
