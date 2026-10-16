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
await fs.cp(path.join(skill,'assets/fixtures/ronin'),path.join(output,'ronin-fixtures'),{recursive:true})
await fs.cp(path.join(skill,'assets/fixtures/sequence'),path.join(output,'sequence'),{recursive:true})
for(const name of ['utils.ts','utilsResizeCanvasLegacy.ts'])await fs.copyFile(path.join(root,'reference/frontend/src/components/ParamsStep',name),path.join(output,name))
await fs.copyFile(path.join(root,'reference/frontend/src/lib/spriteGridDuplicate.ts'),path.join(output,'original-duplicate.ts'))
const originalScale=await fs.readFile(path.join(root,'reference/frontend/src/components/RoninProCustomScale.tsx'),'utf8')
const scaleBody=originalScale.slice(originalScale.indexOf('  const runMatteStep'),originalScale.indexOf('  return (\n    <Space'))
await fs.writeFile(path.join(output,'original-scale.ts'),`import {applyChromaKeyAdaptiveRegion,applyChromaKeyContiguousFromTopLeft,applyChromaKeyHybridTolerance,cropImageBlob,getTopLeftPixelColor,resizeImageToBlob} from './utils';
export async function originalScale(file:File,p:any){
const {width:targetW=256,height:targetH=256,keepAspect=true,pixelated=true,matteAlgorithm='contiguous',nonContiguousTolerance=5}=p;
let output:string|null=null;const setResultUrl=(value:any)=>{if(typeof value==='function')output=value(output);else output=value};
const t=(key:string)=>key,message={success:()=>{},error:(message:string)=>{throw new Error(message)}};
const setLoading=()=>{},setFfffLoading=()=>{},setFffbLoading=()=>{},setFbfbLoading=()=>{},setC0c0Loading=()=>{},setC0beLoading=()=>{},setBebeLoading=()=>{},setFbffLoading=()=>{},setBec0Loading=()=>{};
${scaleBody}
const modes={resize:runScale,ffff:runFfff,fffb:runFffb,fbfb:runFbfb,fbff:runFbff,c0c0:runC0c0,c0be:runC0be,bebe:runBebe,bec0:runBec0};
await modes[p.mode as keyof typeof modes]();if(!output)throw new Error('No original result');const blob=await(await fetch(output)).blob();URL.revokeObjectURL(output);return blob;}`)
const originalUnify=await fs.readFile(path.join(root,'reference/frontend/src/components/RoninProUnifySize.tsx'),'utf8')
const offsetFunction=originalUnify.slice(originalUnify.indexOf('function cellInnerOffset'),originalUnify.indexOf('export default'))
const unifyStart=originalUnify.indexOf('      const maxW',originalUnify.indexOf('  const runUnify'))
await fs.writeFile(path.join(output,'original-unify.ts'),`${offsetFunction}\nexport async function originalUnify(imgs:HTMLImageElement[],cols:number,padH:string,padV:string){\n${originalUnify.slice(unifyStart,originalUnify.indexOf('      setResultUrl(URL.createObjectURL(blob))',unifyStart))}\nreturn blob;}`)
const workbench = path.join(skill, 'assets/workbench')
const originalFine=await fs.readFile(path.join(root,'reference/frontend/src/components/ImageResizeStroke/ImageFineEditor.tsx'),'utf8')
const blitter=originalFine.slice(originalFine.indexOf('function blitImageDataInto'),originalFine.indexOf('function pointInSelRect'))
const fineCallbacks=originalFine.slice(originalFine.indexOf('  const commitSelectMove'),originalFine.indexOf('  const handlePointerDown'))
await fs.writeFile(path.join(output,'original-fine-editor.ts'),`type SelRect={x:number;y:number;w:number;h:number};\n${blitter}\nexport function originalFineEditor(canvas:HTMLCanvasElement,action:string,p:any){
const useCallback=(fn:any)=>fn,canvasRef={current:canvas},imgSize={w:canvas.width,h:canvas.height};
const {tool=action,brushColor='#000000',brushSize=4,eraserSize=8,tolerance:superEraserTolerance=30}=p;
const pushHistory=()=>{};let rect:any=p.rect??null;const setSelectionRect=(v:any)=>{rect=v};
${fineCallbacks}\nif(action==='move')commitSelectMove(p.rect,p.dx,p.dy);else if(action==='erase')superEraserAt(p.x,p.y);else if(action!=='none')drawAt(p.x,p.y);return rect;}`)
await fs.cp(path.join(skill,'assets/fixtures/fine-editor'),path.join(output,'fine-editor'),{recursive:true})
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
