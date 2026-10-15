import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const directory = path.dirname(fileURLToPath(import.meta.url))
const skill = path.resolve(directory, '../..')
const output = path.join(skill, '.runtime/js')
await mkdir(output, { recursive: true })
await writeFile(path.join(output, 'package.json'), '{"private":true,"type":"module"}\n')
await build({ entryPoints: [path.join(directory, 'entry.ts')], outfile: path.join(output, 'algorithms.mjs'),
  bundle: true, platform: 'node', target: 'node22', format: 'esm',
  plugins: [{ name: 'private-opencv-loader', setup(builder) {
    builder.onResolve({ filter: /(?:\/pixellise\/opencv|\.\/opencv)$/ }, () => ({ path: path.join(directory, 'opencv.mjs') }))
  } }],
  define: { 'import.meta.env.BASE_URL': 'globalThis.__frameroninAssetsBase', '__FRAMERONIN_LOCAL_NODE__': 'true' }, logLevel: 'warning' })
process.stdout.write(JSON.stringify({ status: 'built', output: path.join(output, 'algorithms.mjs') }) + '\n')
await build({ entryPoints: [path.join(skill, 'assets/workbench/src/localProject/managedTasks.ts')],
  outfile: path.join(output, 'managed-tasks.mjs'), bundle: true, platform: 'node', target: 'node22', format: 'esm' })
