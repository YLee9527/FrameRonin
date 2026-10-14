import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const skill = path.resolve(here, '../..')
const root = path.resolve(skill, '../..')
const output = path.join(skill, '.runtime/oracle')
await fs.mkdir(output, { recursive: true })
await fs.cp(path.join(skill, 'assets/workbench/public'), output, { recursive: true })
const manifest = JSON.parse(await fs.readFile(path.join(root, 'doc/baseline/presets.json'), 'utf8'))
await fs.writeFile(path.join(output, 'preset-manifest.json'), JSON.stringify(manifest.map(preset => ({
  id: preset.id, file: preset.source.replace('reference/frontend/public', '')
}))))
await fs.copyFile(path.join(skill, 'assets/fixtures/fixed-rgba-grid-1024.png'), path.join(output, 'fixed-rgba-grid-1024.png'))
const originalMap=await fs.readFile(path.join(root,'reference/frontend/src/components/MapStitch.tsx'),'utf8')
const copied=[originalMap.slice(originalMap.indexOf('function canvasToBlob'),originalMap.indexOf('function FeatheredPreviewImage')),
  originalMap.slice(originalMap.indexOf('function writeAscii'),originalMap.indexOf('function getBaseName'))]
await fs.writeFile(path.join(output,'original-map.ts'),`type LoadedImage={image:HTMLImageElement};type Feather=Record<'top'|'right'|'bottom'|'left',number>;const MAX_FEATHER=50;const FEATHER_STEP=5;\n${copied.join('\n')}\nexport {featheredImageCanvas,makeRelativeTemplate,layeredPsdBlob};`)
const workbench = path.join(skill, 'assets/workbench')
const config = path.join(skill, '.runtime/oracle-vite.config.mjs')
// Keep the original browser's Rollup CommonJS handling. An esbuild-only browser
// bundle exposes Emscripten's self-returning `then` during dynamic import.
await fs.writeFile(config, `import base from ${JSON.stringify(path.join(workbench, 'vite.config.ts'))};
export default {...base,root:${JSON.stringify(path.join(skill, 'tests'))},publicDir:false,
plugins:base.plugins.filter(p=>p.name!=='copy-404'),build:{outDir:${JSON.stringify(output)},emptyOutDir:false,
rollupOptions:{input:${JSON.stringify(path.join(skill, 'tests/browser-oracle.html'))}}}};`)
const result = spawnSync(process.execPath, [path.join(workbench, 'node_modules/vite/bin/vite.js'), 'build', '--config', config],
  { cwd: workbench, stdio: 'inherit' })
if (result.status !== 0) throw new Error(`Browser oracle build failed: ${result.status}`)
await fs.copyFile(path.join(output, 'browser-oracle.html'), path.join(output, 'index.html'))
process.stdout.write(JSON.stringify({ output, serve: 'Use an owned loopback static server; open the test controls manually.' }) + '\n')
