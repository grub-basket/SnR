import esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

const prod = process.argv.includes('--prod');
const watch = process.argv.includes('--watch');

const PLUGIN_DIR = process.env.PLUGIN_DIR
  || '/Users/human/Downloads/Claude Code/Claude Dev Vault/.obsidian/plugins/Slide & Reveal';

function copyAssets() {
  if (!existsSync(PLUGIN_DIR)) mkdirSync(PLUGIN_DIR, { recursive: true });
  for (const f of ['main.js', 'manifest.json', 'styles.css']) {
    if (existsSync(f)) {
      copyFileSync(f, `${PLUGIN_DIR}/${f}`);
      console.log(`copied ${f} → ${PLUGIN_DIR}/${f}`);
    }
  }
}

const opts = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  format: 'cjs',
  target: 'es2020',
  outfile: 'main.js',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  logLevel: 'info',
  plugins: [{
    name: 'copy-on-build',
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length === 0) copyAssets();
      });
    }
  }]
};

if (watch) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log(`watching... output → ${PLUGIN_DIR}`);
} else {
  await esbuild.build(opts);
}
