import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/activate.ts'],
  bundle: true,
  outdir: 'out',
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  external: ['vscode'],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('watching...');
} else {
  await esbuild.build(options);
}
