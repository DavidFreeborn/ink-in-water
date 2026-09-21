const fs=require('node:fs');
const path=require('node:path');
const folder=process.argv[2] || path.join(__dirname,'dist');
const source=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
let markup=source.match(/<main[\s\S]*?<\/main>/)[0];
let css=fs.readFileSync(path.join(__dirname,'styles.css'),'utf8');
css=css.replace(':root {','#ink-app {').replace('* { box-sizing: border-box; }','#ink-app, #ink-app * { box-sizing: border-box; }').replace('body { margin: 0; }','');
// The inline frame grows to its contents. Its visual height must depend on width,
// not viewport height, otherwise frame resizing can feed back into stage sizing.
css+='\n#ink-app.experiment { width:100%; padding:18px 20px; margin:0; }\n';
css+='#ink-app .ink-stage { height:clamp(400px,70vw,660px); }\n';
css+='@media (max-width:639px) { #ink-app.experiment { padding:16px 18px; } #ink-app .ink-stage { height:clamp(300px,86vw,480px); } }\n';
const js=['boundary-view.js','interface.js','ink.js'].map(name=>fs.readFileSync(path.join(__dirname,name),'utf8')).join('\n');
fs.mkdirSync(folder,{recursive:true});
const output=path.join(folder,'ink-in-water.html');
fs.writeFileSync(output,'<style>\n'+css+'\n</style>\n'+markup+'\n<script>\n'+js+'\n</script>\n');
console.log(output);
