import JSZip from 'jszip'
export type ScatterDetectMode='auto'|'alpha'|'colorkey'
export type ScatterOrder='row-major'|'column-major'
export type ScatterFormat='png'|'jpeg'|'webp'
export type ScatterBox={id:string;x:number;y:number;w:number;h:number;row?:number;col?:number;kind?:'grid'|'sprite';name?:string}
export type ScatterDetect={mode:ScatterDetectMode;colorKey:string;threshold:number;mergeGap:number;minPixels:number;minSide:number}
export type ReviewedScatterExport={format:ScatterFormat;quality:number;entries:{box:ScatterBox;name:string}[]}
export type ScatterExport={boxes:ScatterBox[];format:ScatterFormat;quality:number;namesText:string;namePerRow:boolean;order:ScatterOrder}
export const MAX_SCATTER_BOXES=4096,MAX_SCATTER_COMPONENTS=16384
export const scatterDetectDefaults:ScatterDetect={mode:'auto',colorKey:'#ffffff',threshold:24,mergeGap:0,minPixels:4,minSide:1}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const integer=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max
export function validateScatterDetect(v:unknown):asserts v is ScatterDetect{
 if(!object(v)||Object.keys(v).sort().join(',')!==Object.keys(scatterDetectDefaults).sort().join(',')
  ||!['auto','alpha','colorkey'].includes(String(v.mode))||typeof v.colorKey!=='string'||!/^#[a-f\d]{6}$/i.test(v.colorKey)
  ||!integer(v.threshold,1,120)||!integer(v.mergeGap,0,24)||!integer(v.minPixels,1,900000000)||!integer(v.minSide,1,30000))throw new Error('SCATTER_DETECT_INVALID')
}
export function validateScatterBoxes(value:unknown,width:number,height:number):asserts value is ScatterBox[]{
 if(!Array.isArray(value)||value.length>MAX_SCATTER_BOXES)throw new Error('SCATTER_BOX_COUNT')
 const ids=new Set<string>()
 for(const box of value){
  if(!object(box)||Object.keys(box).some(key=>!['id','x','y','w','h','row','col','kind','name'].includes(key))
    ||typeof box.id!=='string'||!/^[a-z\d-]{1,80}$/i.test(box.id)||ids.has(box.id)
    ||![box.x,box.y,box.w,box.h].every(v=>typeof v==='number'&&Number.isFinite(v))
    ||Number(box.x)<0||Number(box.y)<0||Number(box.w)<1||Number(box.h)<1||Number(box.x)+Number(box.w)>width||Number(box.y)+Number(box.h)>height
    ||box.row!==undefined&&!integer(box.row,0,4095)||box.col!==undefined&&!integer(box.col,0,4095)
    ||box.kind!==undefined&&!['grid','sprite'].includes(String(box.kind))||box.name!==undefined&&(typeof box.name!=='string'||box.name.length>1000))throw new Error('SCATTER_BOX_INVALID')
  ids.add(box.id)
 }
}
export function orderedScatterBoxes(boxes:ScatterBox[],order:ScatterOrder){
 if(!['row-major','column-major'].includes(order))throw new Error('SCATTER_ORDER_INVALID')
 const items=boxes.map(box=>({...box}))
 items.sort((a,b)=>order==='column-major'?(Math.abs(a.x-b.x)>8?a.x-b.x:a.y-b.y):(Math.abs(a.y-b.y)>8?a.y-b.y:a.x-b.x))
 return items
}
function sanitizeFileName(value: string | undefined, fallback: string) {
  const cleaned = String(value || '')
    .trim()
    .split('').map(character=>character.charCodeAt(0)<32?'-':character).join('')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned || fallback
}

function parseNames(value: string) {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function outputMime(format: ScatterFormat) {
  return format === 'png' ? 'image/png' : `image/${format}`
}

function outputSuffix(format: ScatterFormat) {
  return format === 'jpeg' ? 'jpg' : format
}

function hexToRgb(hex: string) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!match) return { r: 255, g: 255, b: 255 }
  return {
    r: Number.parseInt(match[1], 16),
    g: Number.parseInt(match[2], 16),
    b: Number.parseInt(match[3], 16),
  }
}


export function detectScatterPixels(imageData:Uint8ClampedArray,width:number,height:number,detect:ScatterDetect,order:ScatterOrder):ScatterBox[]{
 validateScatterDetect(detect)
 if(!integer(width,1,30000)||!integer(height,1,30000)||imageData.length!==width*height*4)throw new Error('SCATTER_PIXELS_INVALID')
    const active = new Uint8Array(width * height)
    const visited = new Uint8Array(width * height)
    const queue = new Uint32Array(width * height)
    let detectionMode = detect.mode

    if (detectionMode === 'auto') {
      let usesAlpha = false
      for (let index = 3; index < imageData.length; index += 4) {
        if (imageData[index]! < 250) {
          usesAlpha = true
          break
        }
      }
      detectionMode = usesAlpha ? 'alpha' : 'colorkey'
    }

    const keyColor = hexToRgb(detect.colorKey)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixelIndex = y * width + x
        const offset = pixelIndex * 4
        const r = imageData[offset]!
        const g = imageData[offset + 1]!
        const b = imageData[offset + 2]!
        const a = imageData[offset + 3]!
        active[pixelIndex] =
          detectionMode === 'alpha'
            ? a > detect.threshold
              ? 1
              : 0
            : a > 0 && Math.abs(r - keyColor.r) + Math.abs(g - keyColor.g) + Math.abs(b - keyColor.b) > detect.threshold * 3
              ? 1
              : 0
      }
    }

    const boxes: ScatterBox[] = []
    for (let index = 0; index < active.length; index += 1) {
      if (!active[index] || visited[index]) continue
      let head = 0
      let tail = 0
      queue[tail] = index
      tail += 1
      visited[index] = 1
      let minX = width
      let minY = height
      let maxX = 0
      let maxY = 0
      let pixels = 0

      while (head < tail) {
        const current = queue[head]!
        head += 1
        const x = current % width
        const y = Math.floor(current / width)
        pixels += 1
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)

        if (x > 0) {
          const next = current - 1
          if (active[next] && !visited[next]) {
            visited[next] = 1
            queue[tail] = next
            tail += 1
          }
        }
        if (x < width - 1) {
          const next = current + 1
          if (active[next] && !visited[next]) {
            visited[next] = 1
            queue[tail] = next
            tail += 1
          }
        }
        if (y > 0) {
          const next = current - width
          if (active[next] && !visited[next]) {
            visited[next] = 1
            queue[tail] = next
            tail += 1
          }
        }
        if (y < height - 1) {
          const next = current + width
          if (active[next] && !visited[next]) {
            visited[next] = 1
            queue[tail] = next
            tail += 1
          }
        }
      }

      const componentWidth = maxX - minX + 1
      const componentHeight = maxY - minY + 1
      if (pixels >= detect.minPixels && componentWidth >= detect.minSide && componentHeight >= detect.minSide) {
        if(boxes.length>=MAX_SCATTER_COMPONENTS)throw new Error('SCATTER_COMPONENT_LIMIT')
        boxes.push({ id: crypto.randomUUID(), x: minX, y: minY, w: componentWidth, h: componentHeight, kind: 'sprite', name: '' })
      }
    }

    const merged: ScatterBox[] = []
    const remaining = [...boxes]
    while (remaining.length) {
      let box = remaining.shift()!
      let changed = true
      while (changed) {
        changed = false
        for (let index = remaining.length - 1; index >= 0; index -= 1) {
          const other = remaining[index]!
          const intersects =
            other.x <= box.x + box.w + detect.mergeGap &&
            other.x + other.w >= box.x - detect.mergeGap &&
            other.y <= box.y + box.h + detect.mergeGap &&
            other.y + other.h >= box.y - detect.mergeGap
          if (intersects) {
            const left = Math.min(box.x, other.x)
            const top = Math.min(box.y, other.y)
            const right = Math.max(box.x + box.w, other.x + other.w)
            const bottom = Math.max(box.y + box.h, other.y + other.h)
            box = { ...box, x: left, y: top, w: right - left, h: bottom - top }
            remaining.splice(index, 1)
            changed = true
          }
        }
      }
      merged.push(box)
    }

    if(merged.length>MAX_SCATTER_BOXES)throw new Error('SCATTER_BOX_LIMIT')
    const sorted = orderedScatterBoxes(merged,order)
 return sorted
}
export function scatterExportEntries(layout:ScatterExport,width:number,height:number){
 if(!object(layout)||Object.keys(layout).sort().join(',')!=='boxes,format,namePerRow,namesText,order,quality'
   ||!['png','jpeg','webp'].includes(layout.format)||!Number.isFinite(layout.quality)||layout.quality<.4||layout.quality>1
   ||typeof layout.namesText!=='string'||layout.namesText.length>256*1024||typeof layout.namePerRow!=='boolean')throw new Error('SCATTER_EXPORT_INVALID')
 validateScatterBoxes(layout.boxes,width,height)
 if(!layout.boxes.length)throw new Error('SCATTER_EXPORT_EMPTY')
 const ordered=orderedScatterBoxes(orderedScatterBoxes(layout.boxes,layout.order),layout.order),names=parseNames(layout.namesText),seen=new Set<string>()
 return ordered.map((box,index)=>{
  const fallback=`slice-${index+1}`
  const base=box.name?sanitizeFileName(box.name,fallback):box.kind==='grid'&&layout.namePerRow&&names[box.row??-1]
   ?sanitizeFileName(`${names[box.row!]}-${(box.col??0)+1}`,fallback):names[index]?sanitizeFileName(names[index],fallback)
   :box.kind==='grid'?`r${(box.row??0)+1}-c${(box.col??0)+1}`:`sprite-${String(index+1).padStart(3,'0')}`
  const name=`${base}.${outputSuffix(layout.format)}`
  const unique=name.normalize('NFC').toLowerCase()
  if(/[\uD800-\uDFFF]/u.test(name)||new TextEncoder().encode(name).length>255||seen.has(unique))throw new Error('SCATTER_EXPORT_FILENAME_COLLISION_OR_LIMIT')
  seen.add(unique);return {box,name}
 })
}
export function checkScatterBudget(width:number,height:number,fileBytes:number,budget:number,frontendBytes:number,layout?:ReviewedScatterExport){
 if(!integer(width,1,30000)||!integer(height,1,30000)||!integer(fileBytes,0,20*1024**2)||!integer(budget,1,2*1024**3)||!integer(frontendBytes,0,2*1024**3))throw new Error('SCATTER_RESOURCE_INVALID')
 let bytes=256*1024**2+width*height*32+fileBytes*8+frontendBytes+MAX_SCATTER_COMPONENTS*512
 if(layout){validateReviewedScatterExport(layout,width,height);const pixels=layout.entries.map(({box})=>Math.floor(box.w)*Math.floor(box.h));bytes+=pixels.reduce((a,b)=>a+b,0)*16+Math.max(...pixels)*16}
 if(bytes>budget)throw new Error('SCATTER_RESOURCE_LIMIT')
 return bytes
}
export function reviewScatterExport(layout:ScatterExport,width:number,height:number):ReviewedScatterExport{
 return {format:layout.format,quality:layout.quality,entries:scatterExportEntries(layout,width,height)}
}
export function validateReviewedScatterExport(value:unknown,width:number,height:number):asserts value is ReviewedScatterExport{
 if(!object(value)||Object.keys(value).sort().join(',')!=='entries,format,quality'||!['png','jpeg','webp'].includes(String(value.format))
  ||typeof value.quality!=='number'||!Number.isFinite(value.quality)||value.quality<.4||value.quality>1||!Array.isArray(value.entries)||!value.entries.length||value.entries.length>MAX_SCATTER_BOXES)throw new Error('SCATTER_REVIEW_INVALID')
 const boxes:unknown[]=[],seen=new Set<string>(),suffix=outputSuffix(value.format as ScatterFormat)
 for(const entry of value.entries){
  if(!object(entry)||Object.keys(entry).sort().join(',')!=='box,name'||typeof entry.name!=='string'||!entry.name.endsWith('.'+suffix)
   ||/[\uD800-\uDFFF]/u.test(entry.name)||/[\\/<>:"|?*]/.test(entry.name)||[...entry.name].some(character=>character.charCodeAt(0)<32)||new TextEncoder().encode(entry.name).length>255)throw new Error('SCATTER_REVIEW_FILENAME')
  const unique=entry.name.normalize('NFC').toLowerCase();if(seen.has(unique))throw new Error('SCATTER_EXPORT_FILENAME_COLLISION_OR_LIMIT')
  seen.add(unique);boxes.push(entry.box)
 }
 validateScatterBoxes(boxes,width,height)
}
export async function exportReviewedScatterZip(source:CanvasImageSource,width:number,height:number,layout:ReviewedScatterExport){
 validateReviewedScatterExport(layout,width,height)
 const zip=new JSZip()
 for(const {box,name}of layout.entries){
  const canvas=document.createElement('canvas');canvas.width=box.w;canvas.height=box.h
  const context=canvas.getContext('2d');if(!context)throw new Error('SCATTER_CANVAS_UNAVAILABLE')
  context.drawImage(source,box.x,box.y,box.w,box.h,0,0,box.w,box.h)
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('SCATTER_ENCODE_FAILED')),outputMime(layout.format),layout.format==='png'?undefined:layout.quality))
  if(blob.type!==outputMime(layout.format))throw new Error('SCATTER_ENCODER_UNAVAILABLE')
  zip.file(name,blob);canvas.width=1;canvas.height=1
 }
 return zip.generateAsync({type:'blob'})
}
export async function exportScatterZip(source:CanvasImageSource,width:number,height:number,layout:ScatterExport){
 return exportReviewedScatterZip(source,width,height,reviewScatterExport(layout,width,height))
}
