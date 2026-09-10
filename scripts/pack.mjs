// Zips the built dist/ into a versioned, store-uploadable archive.
// Usage: pnpm pack:zip   (runs build first via the package.json script)
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, rmSync } from 'node:fs'

if (!existsSync('dist/manifest.json')) {
  console.error('dist/ not built — run `pnpm build` first.')
  process.exit(1)
}

const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'))
const zipName = `${name}-${version}.zip`

rmSync(zipName, { force: true })
// Zip the CONTENTS of dist/ (manifest.json must sit at the archive root).
execFileSync('zip', ['-r', '-X', `../${zipName}`, '.', '-x', '.*'], {
  cwd: 'dist',
  stdio: 'inherit',
})

console.log(`\n✓ Created ${zipName} — upload this to the Chrome Web Store.`)
