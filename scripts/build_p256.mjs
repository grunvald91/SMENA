import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
await mkdir('tgcloud/lib/vendor',{recursive:true});
await build({entryPoints:['scripts/p256-entry.js'],outfile:'tgcloud/lib/vendor/p256.js',bundle:true,format:'esm',platform:'neutral',target:'es2022',minify:true,legalComments:'inline',banner:{js:'// Generated from @noble/curves 2.4.0. Rebuild with npm run build:crypto. MIT licenses: docs/licenses/.'}});
await mkdir('docs/licenses',{recursive:true});
for (const name of ['curves','hashes']) {
  await writeFile(`docs/licenses/noble-${name}-LICENSE.txt`,await readFile(`node_modules/@noble/${name}/LICENSE`));
}
