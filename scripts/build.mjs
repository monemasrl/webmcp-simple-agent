import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'

rmSync('dist', { recursive: true, force: true })
mkdirSync('dist', { recursive: true })

const entries = [
  { in: 'src/bridge/main.ts', out: 'bridge' },
  { in: 'src/content/relay.ts', out: 'relay' },
  { in: 'src/background/index.ts', out: 'background' },
  { in: 'src/panel/main.ts', out: 'panel' },
  { in: 'src/options/main.ts', out: 'options' },
]

await build({
  entryPoints: entries.map((e) => ({ in: e.in, out: e.out })),
  bundle: true,
  format: 'iife',
  outdir: 'dist',
  target: 'chrome120',
  logLevel: 'info',
})

cpSync('manifest.json', 'dist/manifest.json')
cpSync('public', 'dist', { recursive: true })
