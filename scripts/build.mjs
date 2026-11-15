import { appendFile, copyFile, cp, mkdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';

// Assemble a static site from the pinned checkouts, including the normal
// draw.io entry point used when a diagram is reopened in a new window.
const webapp = 'vendor/drawio/src/main/webapp';
await cp(webapp, 'dist', { recursive: true });
await build({
  entryPoints: { wavedrom: 'src/wavedrom/plugin.js', 'wavedrom-render': 'src/wavedrom/render.js',
    pipeline: 'src/pipeline/plugin.js' },
  outdir: 'dist/plugins',
  bundle: true,
  minify: true,
  target: 'es2020',
  legalComments: 'inline',
});
await appendFile('dist/js/app.min.js', "\nApp.pluginRegistry.wavedrom = 'plugins/wavedrom.js';\n");
await copyFile('src/wavedrom/editor.css', 'dist/plugins/wavedrom.css');
await appendFile('dist/js/app.min.js', "\nApp.pluginRegistry.pipeline = 'plugins/pipeline.js';\n");
await copyFile('src/pipeline/editor.css', 'dist/plugins/pipeline.css');
await appendFile('dist/js/PreConfig.js', `
urlParams.p = [urlParams.p, 'wavedrom', 'pipeline'].filter(Boolean).join(';');
urlParams.splash = urlParams.splash || '0';
`);
await mkdir('dist/licenses', { recursive: true });
for (const [name, file] of Object.entries({
  drawio: 'vendor/drawio/LICENSE',
  wavedrom: 'vendor/wavedrom/LICENSE',
  json5: 'node_modules/json5/LICENSE.md',
  onml: 'node_modules/onml/LICENSE',
  tspan: 'node_modules/tspan/LICENSE',
})) {
  await copyFile(file, 'dist/licenses/' + name + '.txt');
}
const version = (await readFile('vendor/drawio/VERSION', 'utf8')).trim();
console.log('Built draw.io ' + version + ' with WaveDrom in dist/');
