// Wrap the esbuild-bundled client program into the DSH browser loader shape:
// window.__ModuleLoader__.load({ id, factory: (require) => ... }).
// Mirrors dsh-maestro-supervisor/scripts/build-client.mjs (single-file variant:
// our client is one bundled CJS file, bare 'react' falls through to the
// loader's own require, and a default-export becomes the plugin object).
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const require = createRequire(import.meta.url)
const { buildSync } = require('esbuild')

const result = buildSync({
  entryPoints: [join(root, 'client', 'index.jsx')],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  external: ['react', 'react-dom'],
  write: false,
  logLevel: 'warning',
})
const bundled = result.outputFiles[0].text

const wrapped = [
  'window.__ModuleLoader__.load({ id: "@ddtcorex/dsh-maestro-observe", factory: (require) => {',
  'var module = { exports: {} };',
  bundled,
  'return module.exports && module.exports.default ? module.exports.default : module.exports; } });',
  '',
].join('\n')

const outputPath = join(root, 'lib', 'client.js')
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, wrapped)
console.log(`client bundle written: ${outputPath} (${bundled.length} chars bundled)`)
