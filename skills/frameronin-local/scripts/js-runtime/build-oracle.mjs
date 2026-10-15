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
const originalGif=await fs.readFile(path.join(root,'reference/frontend/src/components/GifFrameConverter.tsx'),'utf8')
const originalComposite=originalGif.slice(originalGif.indexOf('function compositeFrame('),originalGif.indexOf('function loadImageElement'))
const originalEncoder=originalGif.slice(originalGif.indexOf('      const gif = GIFEncoder()'),originalGif.indexOf('      setGifUrl(URL.createObjectURL(blob))'))
await fs.writeFile(path.join(output,'original-gif.ts'),`import {GIFEncoder,quantize,applyPalette} from '../../assets/workbench/node_modules/gifenc/dist/gifenc.esm.js';\n${originalComposite}\nexport {compositeFrame};\nexport function originalEncode(imgs:ImageData[],frameDelay:number):Blob{\n${originalEncoder}\nreturn blob;\n}`)
const combineStart=originalGif.indexOf('      const top = cropTop',originalGif.indexOf('  const runImagesToSingle'))
let originalCombine=originalGif.slice(combineStart,originalGif.indexOf('      setCombinedUrl',combineStart))
const loadStart=originalCombine.indexOf('      for (const f of combineFiles)'),loadEnd=originalCombine.indexOf('        // 正数=裁切',loadStart)
originalCombine=originalCombine.slice(0,loadStart)+'      for(const img of selected){\n'+originalCombine.slice(loadEnd)
const stitchStart=originalGif.indexOf('      const isVertical',originalGif.indexOf('  const runSimpleStitch'))
const originalStitch=originalGif.slice(stitchStart,originalGif.indexOf('      setStitchResultUrl',stitchStart))
const sliceStart=originalGif.indexOf('      const w = img.naturalWidth',originalGif.indexOf('  const runSplitSingleImage'))
const originalSlice=originalGif.slice(sliceStart,originalGif.indexOf('      setCombineFiles',sliceStart))
await fs.writeFile(path.join(output,'original-sequence.ts'),`export async function combine(selected:HTMLImageElement[],combineCols:number,cropTop:number,cropBottom:number,cropLeft:number,cropRight:number){const imgs:HTMLImageElement[]=[];\n${originalCombine}\nreturn blob;}\nexport async function stitch(imgs:HTMLImageElement[],stitchDirection:string){\n${originalStitch}\nreturn blob;}\nexport async function slice(img:HTMLImageElement,splitRows:number,splitCols:number){const splitFile={name:'fixture.png'};\n${originalSlice}\nreturn files;}`)
await fs.copyFile(path.join(root,'reference/frontend/src/lib/superSplitTransparent.ts'),path.join(output,'original-super.ts'))
const originalPixel=await fs.readFile(path.join(root,'reference/frontend/src/components/ImagePixelate.tsx'),'utf8')
const pixelFunctions=originalPixel.slice(originalPixel.indexOf('function rgbToLab('),originalPixel.indexOf('export default function ImagePixelate'))
await fs.writeFile(path.join(output,'original-pixel.ts'),pixelFunctions+'\nexport {pixelateImage,mergeNearbyColorsImage,reduceTo16Colors};')
await fs.cp(path.join(root,'reference/frontend/src/lib/pixellise'),path.join(output,'original-pixellise'),{recursive:true})
await fs.cp(path.join(root,'reference/frontend/src/lib/perfectPixel'),path.join(output,'original-perfectPixel'),{recursive:true})
await fs.copyFile(path.join(skill,'assets/fixtures/pixel/manifest.json'),path.join(output,'pixel-fixture.json'))
const workbench = path.join(skill, 'assets/workbench')
const config = path.join(skill, '.runtime/oracle-vite.config.mjs')
// Keep the original browser's Rollup CommonJS handling. An esbuild-only browser
// bundle exposes Emscripten's self-returning `then` during dynamic import.
await fs.writeFile(config, `import base from ${JSON.stringify(path.join(workbench, 'vite.config.ts'))};
export default {...base,root:${JSON.stringify(path.join(skill, 'tests'))},publicDir:false,
resolve:{alias:{'image-q':${JSON.stringify(path.join(workbench,'node_modules/image-q/dist/esm/image-q.mjs'))}}},
plugins:base.plugins.filter(p=>p.name!=='copy-404'),build:{outDir:${JSON.stringify(output)},emptyOutDir:false,
rollupOptions:{input:${JSON.stringify(path.join(skill, 'tests/browser-oracle.html'))}}}};`)
const result = spawnSync(process.execPath, [path.join(workbench, 'node_modules/vite/bin/vite.js'), 'build', '--config', config],
  { cwd: workbench, stdio: 'inherit' })
if (result.status !== 0) throw new Error(`Browser oracle build failed: ${result.status}`)
await fs.copyFile(path.join(output, 'browser-oracle.html'), path.join(output, 'index.html'))
process.stdout.write(JSON.stringify({ output, serve: 'Use an owned loopback static server; open the test controls manually.' }) + '\n')
