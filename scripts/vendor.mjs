#!/usr/bin/env node
// The browser libraries the site serves from vendor/, made from the pinned npm packages instead of
// being kept in Git (6.5 MB of other people's code in every clone): three.js for the 3D scene, GSAP
// for motion, and WebLLM for the optional on-device AI (bundled with its one dependency into a
// single ES module, as the browser and its worker import it). Runs after `npm install` / `npm ci`.
import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Read straight from node_modules: three's package exports do not include its package.json.
const pkgDir = (name) => join('node_modules', name);
const versionOf = async (name) => JSON.parse(await readFile(join(pkgDir(name), 'package.json'), 'utf8')).version;
const out = 'vendor';
await mkdir(out, { recursive: true });

await copyFile(join(pkgDir('three'), 'build/three.module.min.js'), join(out, 'three.module.min.js'));
await copyFile(join(pkgDir('gsap'), 'dist/gsap.min.js'), join(out, 'gsap.min.js'));

const llm = pkgDir('@mlc-ai/web-llm');
const version = await versionOf('@mlc-ai/web-llm');
const esbuild = await import('esbuild').catch(() => null);
if (!esbuild) {
  console.log('vendor: esbuild is not installed (production install?): vendor/web-llm.mjs not built');
} else {
  await esbuild.build({
    entryPoints: [join(llm, 'lib/index.js')], bundle: true, format: 'esm', minify: true, platform: 'browser', target: 'es2020',
    outfile: join(out, 'web-llm.mjs'), legalComments: 'none', logLevel: 'warning',
    banner: { js: `/*! @mlc-ai/web-llm ${version} (Apache-2.0) https://github.com/mlc-ai/web-llm, bundled with esbuild */` },
  });
}
console.log(`vendor: three ${await versionOf('three')}, gsap ${await versionOf('gsap')}, web-llm ${version}`);
