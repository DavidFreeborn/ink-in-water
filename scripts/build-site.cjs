const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
fs.mkdirSync(output, {recursive: true});
for (const name of ['index.html', 'styles.css', 'ink.js', 'boundary-view.js', 'interface.js', 'preview.png']) {
  fs.copyFileSync(path.join(root, name), path.join(output, name));
}
fs.writeFileSync(path.join(output, '.nojekyll'), '');
console.log('Built static site in dist/');
