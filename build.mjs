// Builds dist/: the app's bundled entry module and app-manifest.json (the bundle fields a deploy reads).
// The platform adds the port bootstrap, the entry document and the full manifest when it deploys.
// A `data` block in app.json (the app's DATA-01 and WORK-01 contract) is copied unchanged; the deploy checks it.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const app = JSON.parse(await readFile('interface/app/app.json', 'utf8'));
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
await build({
  entryPoints: ['interface/app/src/main.mjs'],
  outfile: 'dist/main.mjs',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  external: ['./ot-bootstrap.mjs'],
  legalComments: 'none',
  logLevel: 'warning',
});
const manifest = {
  version: app.version,
  title: app.title,
  main: 'main.mjs',
  preload: [],
  styles: [],
  csp: app.csp,
  channel: app.channel,
  ...(app.data === undefined ? {} : { data: app.data }),
};
await writeFile('dist/app-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
