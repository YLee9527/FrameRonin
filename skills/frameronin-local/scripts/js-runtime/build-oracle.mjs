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
await fs.copyFile(path.join(root,'reference/frontend/src/lib/geminiWatermark.ts'),path.join(output,'original-gemini-watermark.ts'))
const watermarkSource=await fs.readFile(path.join(root,'reference/frontend/src/components/ImageGeminiWatermark.tsx'),'utf8')
const watermarkBody=watermarkSource.slice(watermarkSource.indexOf('      const img = await'),watermarkSource.indexOf('      if (blob)'))
if(!watermarkBody.includes('const alphaScale = baseSize === 96 ? 0.85 : 1'))throw new Error('Original standalone watermark markers changed')
await fs.writeFile(path.join(output,'original-visible-watermark.ts'),`import {getWatermarkSize,getWatermarkParams,getEmbeddedAlphaMask,createApproxAlphaMap,removeWatermarkReverseAlpha,type WatermarkSize} from './original-gemini-watermark';
export async function originalVisibleWatermark(file:Blob,sizeMode:string){const imageUrl=URL.createObjectURL(file);try{${watermarkBody}if(!blob)throw new Error('Original PNG encoding failed');return blob;}finally{URL.revokeObjectURL(imageUrl)}}`)
await fs.cp(path.join(skill,'assets/fixtures/visible-watermark'),path.join(output,'visible-watermark'),{recursive:true})
const spriteSource=await fs.readFile(path.join(root,'reference/frontend/src/components/SpriteSheetTool.tsx'),'utf8')
const spriteHelpers=spriteSource.slice(spriteSource.indexOf('function splitSpriteSheet('),spriteSource.indexOf('export default function'))
const spriteGifBody=spriteSource.slice(spriteSource.indexOf('      const allImgs = currentFrames'),spriteSource.indexOf('      setGifZipUrl(URL.createObjectURL(zipBlob))'))
if(!spriteHelpers.includes('count: idx')||!spriteGifBody.includes('normalizeToMax')||!spriteGifBody.includes('zip.generateAsync'))throw new Error('Original sprite sheet markers changed')
await fs.writeFile(path.join(output,'original-sprite-sheet.ts'),`import JSZip from '../../assets/workbench/node_modules/jszip';
import {GIFEncoder,quantize,applyPalette} from '../../assets/workbench/node_modules/gifenc/dist/gifenc.esm.js';
${spriteHelpers}
async function source(file:Blob){const url=URL.createObjectURL(file);try{return await new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Original image load failed'));image.src=url})}finally{URL.revokeObjectURL(url)}}
export async function originalSpriteSplit(file:Blob,columns:number,rows:number){const frames=splitSpriteSheet(await source(file),columns,rows),zip=new JSZip();try{for(let i=0;i<frames.length;i++){const blob=await new Promise<Blob>((resolve,reject)=>frames[i].canvas.toBlob(b=>b?resolve(b):reject(new Error('Original PNG encoding')),'image/png'));zip.file('frame_'+String(i).padStart(3,'0')+'.png',blob)}return await zip.generateAsync({type:'blob'})}finally{for(const f of frames)f.canvas.width=f.canvas.height=1}}
export async function originalSpriteGifs(file:Blob,p:any){const frames=splitSpriteSheet(await source(file),p.columns,p.rows),raw:ImageData[]=[],canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!,urls:string[]=[],setGifUrls=(items:any[])=>urls.push(...items.map(x=>x.url));try{for(const f of frames){canvas.width=f.canvas.width;canvas.height=f.canvas.height;ctx.drawImage(f.canvas,0,0);raw.push(ctx.getImageData(0,0,canvas.width,canvas.height))}const currentFrames=p.order.map((i:number)=>raw[i]),togifFrameColsRef={current:p.framesPerRow},frameDelay=p.duration;${spriteGifBody}return zipBlob;}finally{urls.forEach(URL.revokeObjectURL);canvas.width=canvas.height=1;for(const f of frames)f.canvas.width=f.canvas.height=1}}`)
await fs.cp(path.join(skill,'assets/fixtures/sprite-sheet'),path.join(output,'sprite-sheet'),{recursive:true})
const normalSource=await fs.readFile(path.join(root,'reference/frontend/src/components/ImageResizeStroke.tsx'),'utf8')
const recipes=[['apply','applyPreview'],['mattePreview','runMattePreview'],['extendBottom','handleExtendBottom'],['rpgMaker','handleOneClickProcess'],['allActions','handleOneClickAllActionsProcess'],['ancientCostume','handleAncientCostumeProcess']]
const originalRecipes=recipes.map(([mode,handler])=>{
  const start=normalSource.indexOf(`  const ${handler} = async () => {`)
  if(start<0)throw new Error(`Original recipe missing: ${handler}`)
  const block=normalSource.slice(start,normalSource.indexOf('\n  const ',start+1))
  const begin=block.indexOf(mode==='extendBottom'?'      const blob = await':'      let blob = await')
  const end=block.indexOf(mode==='mattePreview'?'      setMattePreviewUrl':'      setPreviewBlob(blob)',begin)
  if(begin<0||end<begin)throw new Error(`Original recipe markers changed: ${handler}`)
  return `if(mode===${JSON.stringify(mode)}){${block.slice(begin,end)}return ${mode==='mattePreview'?'matteBlob':'blob'};}`
}).join('\n')
await fs.writeFile(path.join(output,'original-normal.ts'),`import {applyChromaKey,applyChromaKeyContiguousFromTopLeft,applyInnerStroke,cropImageBlob,extendImageBottom,getTopLeftPixelColor,processAncientCostumeAllActions,resizeImageToBlob} from './utils';\nimport {removeGeminiWatermarkFromBlob} from './original-gemini-watermark';\nexport async function originalNormal(file:Blob,p:any){const previewBlob=file,{mode,width:targetW,height:targetH,keepAspect,pixelated,enableMatte,background:bgColor,tolerance:matteTolerance,feather:matteFeather,strokeWidth,strokeColor}=p;const cropRegion={left:p.cropLeft,top:p.cropTop,right:p.cropRight,bottom:p.cropBottom},m=bgColor.match(/^#?([a-f\\d]{2})([a-f\\d]{2})([a-f\\d]{2})$/i);\n${originalRecipes}\nthrow new Error('Original recipe unknown');}`)
await fs.cp(path.join(skill,'assets/fixtures/normal-image'),path.join(output,'normal-image'),{recursive:true})
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
const originalExpand=await fs.readFile(path.join(root,'reference/frontend/src/components/ImageExpandShrink.tsx'),'utf8')
const expandBody=originalExpand.slice(originalExpand.indexOf('async function expandShrinkImage('),originalExpand.indexOf('export default function'))
await fs.writeFile(path.join(output,'original-expand-shrink.ts'),expandBody+`\nexport async function originalExpandShrink(file:Blob,p:any){const url=URL.createObjectURL(file);try{const img=await new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Original image load failed'));image.src=url});return await expandShrinkImage(img,p.columns,p.rows,p.cellWidth,p.cellHeight)}finally{URL.revokeObjectURL(url)}}`)
await fs.cp(path.join(skill,'assets/fixtures/expand-shrink'),path.join(output,'expand-shrink'),{recursive:true})
const originalScatter=await fs.readFile(path.join(root,'reference/frontend/src/components/RoninProScatterSlice.tsx'),'utf8')
const scatterHelpers=originalScatter.slice(originalScatter.indexOf('function clamp('),originalScatter.indexOf('export default function'))
const orderStart=originalScatter.indexOf('      const items = boxes.map',originalScatter.indexOf('  const orderedBoxes ='))
const orderBody=originalScatter.slice(orderStart,originalScatter.indexOf('    },',orderStart))
const detectStart=originalScatter.indexOf('    const active = new Uint8Array',originalScatter.indexOf('  const detectSprites ='))
const detectBody=originalScatter.slice(detectStart,originalScatter.indexOf('    setSprites(sorted)',detectStart))
const nameStart=originalScatter.indexOf('      const explicitNames = parseNames',originalScatter.indexOf('  const defaultNameFor ='))
const nameBody=originalScatter.slice(nameStart,originalScatter.indexOf('    },',nameStart))
const zipStart=originalScatter.indexOf('      const zip = new JSZip()',originalScatter.indexOf('  const downloadZip ='))
const zipBody=originalScatter.slice(zipStart,originalScatter.indexOf('      const url = URL.createObjectURL(archive)',zipStart))
await fs.writeFile(path.join(output,'original-scatter.ts'),`import JSZip from '../../assets/workbench/node_modules/jszip';\n${scatterHelpers}\nasync function source(file:File){const img=await loadImageFromFile(file),canvas=createOffscreenCanvas(img.naturalWidth,img.naturalHeight);canvas.getContext('2d',{willReadFrequently:true})!.drawImage(img,0,0);return canvas}\nexport async function originalScatterDetect(file:File,p:any){const sourceCanvas=await source(file),sourceCtx=sourceCanvas.getContext('2d')!,imageInfo={width:sourceCanvas.width,height:sourceCanvas.height}, {width,height}=imageInfo, {detect,order}=p;const orderedBoxes=(boxes:any[])=>{${orderBody}};const imageData=sourceCtx.getImageData(0,0,width,height).data;${detectBody}return {formatVersion:1,width,height,boxes:sorted};}\nexport async function originalScatterExport(file:File,p:any){const sourceCanvasRef={current:await source(file)}, {format,quality,namesText,namePerRow,order}=p;const orderedBoxes=(boxes:any[])=>{${orderBody}},boxes=orderedBoxes(p.boxes),defaultNameFor=(box:any,index:number,ordered:any[])=>{${nameBody}};${zipBody}return archive;}`)
await fs.cp(path.join(skill,'assets/fixtures/scatter'),path.join(output,'scatter'),{recursive:true})
const originalCustom=await fs.readFile(path.join(root,'reference/frontend/src/components/RoninProCustomSlice.tsx'),'utf8')
const customHelpers=originalCustom.slice(originalCustom.indexOf('/** 找出完全透明的行索引 */'),originalCustom.indexOf('export default function'))
const composeStart=originalCustom.indexOf('    const cellW = Math.max',originalCustom.indexOf('  const runCompose ='))
const composeBody=originalCustom.slice(composeStart,originalCustom.indexOf('      setComposedUrl(URL.createObjectURL(blob))',composeStart))
await fs.writeFile(path.join(output,'original-custom-slice.ts'),`import JSZip from '../../assets/workbench/node_modules/jszip';
${customHelpers}
async function load(url:string){return await new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Original image load failed'));img.src=url})}
export async function originalCustomPlan(file:File,p:any){const url=URL.createObjectURL(file);try{const img=await load(url),canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d')!;ctx.drawImage(img,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height);let columns=p.columns,rows=p.rows;if(p.mode==='auto'){const d=detectAutoSplit(data);columns=d.cols;rows=d.rows}const refine=p.refine==='l7'&&rows>1;return {formatVersion:1,width:canvas.width,height:canvas.height,columns,rows,colStarts:refine?adjustColBoundariesL7(data.data,canvas.width,canvas.height,columns,p.bandPercent/100):uniformColStarts(canvas.width,columns),rowStarts:refine?adjustRowBoundariesL7(data.data,canvas.width,canvas.height,rows,p.bandPercent/100):uniformRowStarts(canvas.height,rows),bandColOffset:Array.from({length:rows},()=>0),bendY:Math.floor(canvas.height/2),deltaX:0}}finally{URL.revokeObjectURL(url)}}
export async function originalCustomSplit(file:File,p:any){const url=URL.createObjectURL(file);try{const img=await load(url),l=p.layout,frames=l.mode==='grid'?splitSpriteSheet(img,l.columns,l.rows,null):l.mode==='regions'?splitByRegions(img,l.regions):l.mode==='bands'?splitSpriteSheetWithBandOffsets(img,l.colStarts,l.rowStarts,l.bandColOffset):splitSpriteSheetSingleRowPolyline(img,l.colStarts,img.naturalHeight,l.bendY,l.deltaX),zip=new JSZip();for(let i=0;i<frames.length;i++){const blob=await new Promise<Blob>((resolve,reject)=>frames[i].toBlob(b=>b?resolve(b):reject(new Error('Original PNG encoding')),'image/png'));zip.file('frame_'+String(i).padStart(3,'0')+'.png',blob)}return await zip.generateAsync({type:'blob'})}finally{URL.revokeObjectURL(url)}}
export async function originalCustomCompose(file:Blob,p:any){const zip=await JSZip.loadAsync(file),blobs=await Promise.all(Object.keys(zip.files).map(name=>zip.file(name)!.async('blob'))),frameBlobUrls=blobs.map(blob=>URL.createObjectURL(blob)),images=await Promise.all(frameBlobUrls.map(load)),frameSizes=images.map(img=>({w:img.naturalWidth,h:img.naturalHeight}));const {rows:rearrangeRows,columns:rearrangeCols,grid:rearrangeGrid,expandUp,expandDown,expandLeft,expandRight}=p.composition;
${composeBody}return blob;}finally{for(const url of frameBlobUrls)URL.revokeObjectURL(url);canvas.width=1;canvas.height=1;cellBuf.width=1;cellBuf.height=1;}}
`)
await fs.cp(path.join(skill,'assets/fixtures/custom-slice'),path.join(output,'custom-slice'),{recursive:true})
const workbench = path.join(skill, 'assets/workbench')
const originalAdjust=await fs.readFile(path.join(root,'reference/frontend/src/components/SpriteSheetAdjust.tsx'),'utf8')
const adjustCrop=originalAdjust.slice(originalAdjust.indexOf('function frameCropDrawParams'),originalAdjust.indexOf('const ShiftedFrameCanvas'))
const adjustCompose=originalAdjust.slice(originalAdjust.indexOf('async function recombineFrames'),originalAdjust.indexOf('function loadImageElement'))
const adjustLoad=originalAdjust.slice(originalAdjust.indexOf('function loadImageElement'),originalAdjust.indexOf('function createTransparentFrameUrl'))
const adjustGifStart=originalAdjust.indexOf('      const delayMs =',originalAdjust.indexOf('  const handleExportGif ='))
const adjustGif=originalAdjust.slice(adjustGifStart,originalAdjust.indexOf('      const url = URL.createObjectURL(blob)',adjustGifStart))
const adjustFixStart=originalAdjust.indexOf('    for (let i = 0; i < total;',originalAdjust.indexOf('  const applyFixedPixels ='))
const adjustFix=originalAdjust.slice(adjustFixStart,originalAdjust.indexOf('    setFrameUrls(newUrls)',adjustFixStart))
if(!adjustGif.includes('gif.finish()')||!adjustFix.includes('mask[py * frameW + px]'))throw new Error('Original sheet adjustment markers changed')
await fs.writeFile(path.join(output,'original-sheet-adjust.ts'),`import JSZip from '../../assets/workbench/node_modules/jszip';\nimport {GIFEncoder,quantize,applyPalette} from '../../assets/workbench/node_modules/gifenc/dist/gifenc.esm.js';\ntype FrameOffset={dx:number;dy:number};type FrameCrop={top:number;bottom:number;left:number;right:number};const emptyCrop=()=>({top:0,bottom:0,left:0,right:0});\n${adjustCrop}\n${adjustCompose}\n${adjustLoad}\nexport async function originalSheetAdjust(files:Blob[],action:string,p:any){const urls=files.map(f=>URL.createObjectURL(f)),temporary:string[]=[];try{\nconst frameUrls=action==='fix'?urls:p.frames.map((f:any)=>urls[f.sourceIndex]),frameOffsets=p.frames?.map((f:any)=>({dx:f.dx,dy:f.dy})),effectiveFrameCrops=p.frames?.map((f:any)=>f.crop);\nif(action==='compose'){const result=await recombineFrames(frameUrls,frameOffsets,effectiveFrameCrops,p.columns,p.rows);temporary.push(result.url);return await(await fetch(result.url)).blob()}\nif(action==='gif'){const images=await Promise.all(frameUrls.map(loadImageElement));let cellW=1,cellH=1;for(let i=0;i<images.length;i++){const cr=effectiveFrameCrops[i];cellW=Math.max(cellW,images[i].naturalWidth-cr.left-cr.right);cellH=Math.max(cellH,images[i].naturalHeight-cr.top-cr.bottom)}const layoutReady=true,selected=frameUrls.map((_:string,i:number)=>p.selected.includes(i)),indices=frameUrls.map((_:string,i:number)=>i).filter((i:number)=>selected[i]),speedScale=p.speedScale,frameDelay=100;\n${adjustGif}\nreturn blob;}\nif(action==='fix'){const frameW=p.referenceWidth,frameH=p.referenceHeight,fixedPixelFixes=p.fixes.map((f:any)=>({...f,data:new Uint8ClampedArray(f.data)})),selected=urls.map((_,i)=>p.selected.includes(i)),newUrls:string[]=[],total=urls.length,setApplyProgress=()=>{};\n${adjustFix}\ntemporary.push(...newUrls);const zip=new JSZip();for(let i=0;i<newUrls.length;i++)zip.file('frame_'+String(i).padStart(3,'0')+'.png',await(await fetch(newUrls[i])).blob());return await zip.generateAsync({type:'blob'})}\nthrow new Error('Original adjustment action missing');}finally{[...urls,...temporary].forEach(URL.revokeObjectURL)}}`)
await fs.cp(path.join(skill,'assets/fixtures/sheet-adjust'),path.join(output,'sheet-adjust'),{recursive:true})
let originalPreprocess=await fs.readFile(path.join(root,'reference/frontend/src/lib/sheetProPreprocess.ts'),'utf8')
for(const [from,to]of [['../components/ParamsStep/utils','./utils'],['./geminiWatermark','./original-gemini-watermark'],['./roninProWorkflowGridOps','./original-workflow-grid']]){
 if(!originalPreprocess.includes(from))throw new Error('Original sheet preprocess import changed')
 originalPreprocess=originalPreprocess.replace(from,to)
}
await fs.writeFile(path.join(output,'original-sheet-preprocess.ts'),originalPreprocess)
await fs.writeFile(path.join(output,'original-workflow-grid.ts'),(await fs.readFile(path.join(root,'reference/frontend/src/lib/roninProWorkflowGridOps.ts'),'utf8')).replace('../components/ParamsStep/utils','./utils'))
const prepareWhole=originalAdjust.slice(originalAdjust.indexOf('function splitSpriteSheet('),originalAdjust.indexOf('async function recombineFrames('))
const prepareUniformStart=originalAdjust.indexOf('      const w = img.naturalWidth',originalAdjust.indexOf('  const applySplitFromGrid ='))
const prepareUniform=originalAdjust.slice(prepareUniformStart,originalAdjust.indexOf('      pendingIntrinsicSizesRef.current',prepareUniformStart))
const prepareBlank=originalAdjust.slice(originalAdjust.indexOf('function createTransparentFrameUrl'),originalAdjust.indexOf('/** RoninPro'))
const packStart=originalAdjust.indexOf('      const zip = new JSZip()',originalAdjust.indexOf('  const downloadFramesZip ='))
const packBody=originalAdjust.slice(packStart,originalAdjust.indexOf('      const href = URL.createObjectURL(zblob)',packStart))
if(!prepareUniform.includes('GRID_TOBLOB_BATCH')||!prepareBlank.includes('canvas.toBlob')||!packBody.includes('zip.generateAsync'))throw new Error('Original preparation markers changed')
await fs.writeFile(path.join(output,'original-sheet-prepare.ts'),`import JSZip from '../../assets/workbench/node_modules/jszip';\nimport {superSplitByTransparent} from './original-super';\n${prepareWhole}\n${prepareBlank}\n${adjustLoad}\nasync function pack(files:Blob[]){const zip=new JSZip();for(let i=0;i<files.length;i++)zip.file('frame_'+String(i).padStart(3,'0')+'.png',files[i]);return await zip.generateAsync({type:'blob'})}\nexport async function originalSheetPrepare(file:Blob,p:any){const source=URL.createObjectURL(file),temporary:string[]=[];try{const img=await loadImageElement(source);if(p.mode==='whole'){const frames=splitSpriteSheet(img,p.columns,p.rows),files=await Promise.all(frames.map(c=>new Promise<Blob>((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('blob')),'image/png'))));return await pack(files)}if(p.mode==='uniform'){const splitRowsIn=p.rows,splitColsIn=p.columns;${prepareUniform}\ntemporary.push(...urls);return await pack(await Promise.all(urls.map(async url=>(await fetch(url)).blob())))}if(p.mode==='transparent')return await pack(await superSplitByTransparent(img,'sheet'));throw new Error('Original preparation mode missing')}finally{[source,...temporary].forEach(URL.revokeObjectURL)}}\nexport async function originalSheetFrames(files:Blob[],p:any){const ordered=p.order.map((i:number)=>files[i]),temporary:string[]=[];try{if(p.blank){const url=await createTransparentFrameUrl(p.blank.width,p.blank.height);temporary.push(url);ordered.push(await(await fetch(url)).blob())}const frameUrls=ordered.map((b:Blob)=>URL.createObjectURL(b)),file={name:'fixture.png'};temporary.push(...frameUrls);${packBody}\nreturn zblob;}finally{temporary.forEach(URL.revokeObjectURL)}}`)
await fs.cp(path.join(skill,'assets/fixtures/sheet-prepare'),path.join(output,'sheet-prepare'),{recursive:true})
const originalMatte=await fs.readFile(path.join(root,'reference/frontend/src/components/ImageMatte.tsx'),'utf8')
const matteLoad=originalMatte.slice(originalMatte.indexOf('async function imageToBlob'),originalMatte.indexOf('const GREEN:'))
const matteAlgorithms=originalMatte.slice(originalMatte.indexOf('/** Canvas 2D 色度键'),originalMatte.indexOf('type AlgorithmType'))
if(!matteAlgorithms.includes('const erodePasses = Math.min(5')||!matteLoad.includes('blobToImage'))throw new Error('Original matte markers changed')
await fs.copyFile(path.join(root,'reference/frontend/src/lib/doubleBackgroundMatte.ts'),path.join(output,'original-double-background.ts'))
await fs.writeFile(path.join(output,'original-matte-tool.ts'),`import {processDoubleBackground,postProcessDoubleBackgroundMatte,applyAlphaErosionToCanvas} from './original-double-background';\nimport {removeGeminiWatermarkFromBlob} from './original-gemini-watermark';\n${matteLoad}\n${matteAlgorithms}\nconst encode=(c:HTMLCanvasElement)=>new Promise<Blob>((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('original encode')),'image/png'));\nconst draw=(img:HTMLImageElement)=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d')!.drawImage(img,0,0);return c};\nexport async function originalMatteTool(files:Blob[],p:any){const imgs=await Promise.all(files.map(blobToImage));let canvas:HTMLCanvasElement;if(p.mode==='chroma'){const color=p.keyColor.slice(1).match(/../g).map((c:string)=>parseInt(c,16));canvas=chromaKeyCanvas(imgs[0],color,p.tolerance,p.smoothness,p.spill);const passes=Math.min(5,Math.round((p.erosion/100)*10));if(passes>0)canvas=erodeAlphaOnCanvas(canvas,passes)}else if(p.mode==='whiteErode')canvas=whiteKeyErodeGLSL(imgs[0],p.tolerance,p.smoothness,p.erosion);else if(p.mode==='doubleBg'){const clean=await Promise.all(imgs.map(async img=>blobToImage(await removeGeminiWatermarkFromBlob(await imageToBlob(img)))));canvas=processDoubleBackground(clean[0],clean[1],p.tolerance,p.edgeContrast)}else if(p.mode==='repair')canvas=postProcessDoubleBackgroundMatte(draw(imgs[0]));else if(p.mode==='frontier')canvas=applyAlphaErosionToCanvas(draw(imgs[0]),p.erosion);else throw new Error('Original matte mode');return encode(canvas)};`)
await fs.cp(path.join(skill,'assets/fixtures/matte-tool'),path.join(output,'matte-tool'),{recursive:true})
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
