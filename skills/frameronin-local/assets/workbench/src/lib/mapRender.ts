import JSZip from 'jszip'
import { applyMapFeather } from './mapFeather'
import type { MapTile, MapFeather } from '../localProject/mapDocument'
export type MapRenderLayer = { inputIndex: number; key: string; tile: MapTile; feather: MapFeather }
export type MapRenderLayout = { sourceName: string; width: number; height: number; horizontalOverlapPercent: number; verticalOverlapPercent: number; layers: MapRenderLayer[] }
function canvas(width: number, height: number): HTMLCanvasElement {
  const result=document.createElement('canvas');result.width=width;result.height=height;return result
}
function png(canvas:HTMLCanvasElement):Promise<Blob>{return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('MAP_ENCODE_FAILED')),'image/png'))}
function layerCanvas(image:CanvasImageSource,width:number,height:number,feather:MapFeather,key:string):HTMLCanvasElement{
  const result=canvas(width,height),ctx=result.getContext('2d')!;ctx.imageSmoothingEnabled=false;ctx.drawImage(image,0,0,width,height)
  if(key!=='0,0'&&Object.values(feather).some(Boolean)){
    const pixels=ctx.getImageData(0,0,width,height);applyMapFeather(pixels.data,width,height,feather);ctx.putImageData(pixels,0,0)
  }
  return result
}
function writeAscii(out: number[], value: string) {
  for (let i = 0; i < value.length; i++) out.push(value.charCodeAt(i) & 0xff)
}

function writeU16(out: number[], value: number) {
  out.push((value >>> 8) & 0xff, value & 0xff)
}

function writeU32(out: number[], value: number) {
  out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
}

function writeI16(out: number[], value: number) {
  writeU16(out, value < 0 ? 0x10000 + value : value)
}

function bytesFromWriter(write: (out: number[]) => void): Uint8Array<ArrayBuffer> {
  const out: number[] = []
  write(out)
  return new Uint8Array(out)
}

function psdPascalName(name: string): Uint8Array<ArrayBuffer> {
  const bytes = Array.from(name).map((ch) => ch.charCodeAt(0) & 0x7f)
  const len = Math.min(255, bytes.length)
  const total = 1 + len
  const padded = total + ((4 - (total % 4)) % 4)
  const out = new Uint8Array(padded)
  out[0] = len
  for (let i = 0; i < len; i++) out[i + 1] = bytes[i] ?? 0
  return out
}

function imageDataChannelBytes(imageData: ImageData, channel: 0 | 1 | 2 | 3): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(imageData.width * imageData.height)
  const data = imageData.data
  for (let src = channel, dst = 0; src < data.length; src += 4, dst++) {
    out[dst] = data[src] ?? 0
  }
  return out
}

type PsdLayer = {
  name: string
  left: number
  top: number
  imageData: ImageData
}

function layeredPsdBlob(width: number, height: number, composite: ImageData, layers: PsdLayer[]): Blob {
  if (width > 30000 || height > 30000) {
    throw new Error('PSD 尺寸超过 30000px，请减少扩展范围后再导出')
  }

  const chunks: BlobPart[] = []
  chunks.push(bytesFromWriter((out) => {
    writeAscii(out, '8BPS')
    writeU16(out, 1)
    out.push(0, 0, 0, 0, 0, 0)
    writeU16(out, 4)
    writeU32(out, height)
    writeU32(out, width)
    writeU16(out, 8)
    writeU16(out, 3)
    writeU32(out, 0)
    writeU32(out, 0)
  }))

  const layerRecordChunks: BlobPart[] = []
  const channelDataChunks: BlobPart[] = []
  let layerRecordsLen = 2
  let layerChannelsLen = 0

  for (const layer of layers) {
    const layerW = layer.imageData.width
    const layerH = layer.imageData.height
    const channelByteLen = layerW * layerH
    const channelDataLen = 2 + channelByteLen
    const nameBytes = psdPascalName(layer.name)
    const extraLen = 4 + 4 + nameBytes.length

    const record = bytesFromWriter((out) => {
      writeU32(out, layer.top)
      writeU32(out, layer.left)
      writeU32(out, layer.top + layerH)
      writeU32(out, layer.left + layerW)
      writeU16(out, 4)
      for (const channelId of [0, 1, 2, -1]) {
        writeI16(out, channelId)
        writeU32(out, channelDataLen)
      }
      writeAscii(out, '8BIM')
      writeAscii(out, 'norm')
      out.push(255, 0, 8, 0)
      writeU32(out, extraLen)
      writeU32(out, 0)
      writeU32(out, 0)
      for (const b of nameBytes) out.push(b)
    })
    layerRecordChunks.push(record)
    layerRecordsLen += record.length

    for (const channel of [0, 1, 2, 3] as const) {
      channelDataChunks.push(bytesFromWriter((out) => writeU16(out, 0)))
      channelDataChunks.push(imageDataChannelBytes(layer.imageData, channel))
      layerChannelsLen += channelDataLen
    }
  }

  const layerInfoLenRaw = layerRecordsLen + layerChannelsLen
  const layerInfoPad = layerInfoLenRaw % 2
  const layerInfoLen = layerInfoLenRaw + layerInfoPad
  const layerMaskLen = 4 + layerInfoLen + 4

  chunks.push(bytesFromWriter((out) => {
    writeU32(out, layerMaskLen)
    writeU32(out, layerInfoLen)
    writeI16(out, layers.length)
  }))
  chunks.push(...layerRecordChunks)
  chunks.push(...channelDataChunks)
  if (layerInfoPad) chunks.push(new Uint8Array([0]) as Uint8Array<ArrayBuffer>)
  chunks.push(bytesFromWriter((out) => writeU32(out, 0)))

  chunks.push(bytesFromWriter((out) => writeU16(out, 0)))
  for (const channel of [0, 1, 2, 3] as const) {
    chunks.push(imageDataChannelBytes(composite, channel))
  }

  return new Blob(chunks, { type: 'image/vnd.adobe.photoshop' })
}

function safeFilename(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'tile'
}

function tscnString(value: string): string {
  return JSON.stringify(value)
}

function godotSceneTscn(
  sceneName: string,
  tiles: Array<{ name: string; image: string; pixel: { x: number; y: number } }>,
): string {
  const lines = ['[gd_scene load_steps=' + (tiles.length + 1) + ' format=3 uid="uid://pixelwork_map_stitch"]', '']
  tiles.forEach((tile, index) => {
    lines.push(`[ext_resource type="Texture2D" path=${tscnString(`res://${tile.image}`)} id=${tscnString(`tex_${index + 1}`)}]`)
  })
  lines.push('', `[node name=${tscnString(sceneName)} type="Node2D"]`, '')
  tiles.forEach((tile, index) => {
    lines.push(`[node name=${tscnString(safeFilename(tile.name))} type="Sprite2D" parent="."]`)
    lines.push(`position = Vector2(${tile.pixel.x}, ${tile.pixel.y})`)
    lines.push('centered = false')
    lines.push(`texture = ExtResource(${tscnString(`tex_${index + 1}`)})`)
    lines.push('')
  })
  return lines.join('\n')
}


export async function renderMapExport(images:CanvasImageSource[],layout:MapRenderLayout,format:'png'|'psd'|'godot'|'template',target?:MapTile):Promise<Blob>{
  const tiles=layout.layers.map(layer=>layer.tile)
  const minX=format==='template'?target!.x:Math.min(...tiles.map(tile=>tile.x))
  const minY=format==='template'?target!.y:Math.min(...tiles.map(tile=>tile.y))
  const width=Math.max(1,Math.round((format==='template'?target!.w:Math.max(...tiles.map(tile=>tile.x+tile.w))-minX)*layout.width))
  const height=Math.max(1,Math.round((format==='template'?target!.h:Math.max(...tiles.map(tile=>tile.y+tile.h))-minY)*layout.height))
  // Godot packages need individual layers, not a potentially enormous sparse composite.
  const composite=format==='godot'?null:canvas(width,height),ctx=composite?.getContext('2d')
  if(ctx)ctx.imageSmoothingEnabled=false
  const layers:PsdLayer[]=[]
  const manifest=[]
  const zip=format==='godot'?new JSZip():null
  for(const layer of layout.layers){
    const drawWidth=Math.max(1,Math.round(layer.tile.w*layout.width)),drawHeight=Math.max(1,Math.round(layer.tile.h*layout.height))
    const left=Math.round((layer.tile.x-minX)*layout.width),top=Math.round((layer.tile.y-minY)*layout.height)
    const name=layer.key==='0,0'?'source':`tile_${layer.key.replace(',', '_')}`
    // Overlap templates preserve unfeathered original neighbors.
    const feather=format==='template'?{top:0,right:0,bottom:0,left:0}:layer.feather
    const rendered=layerCanvas(images[layer.inputIndex],drawWidth,drawHeight,feather,layer.key)
    const drawable=layer.key==='0,0'||!Object.values(feather).some(Boolean)?images[layer.inputIndex]:rendered
    ctx?.drawImage(drawable,left,top,drawWidth,drawHeight)
    if(format==='psd')layers.push({name,left,top,imageData:rendered.getContext('2d')!.getImageData(0,0,drawWidth,drawHeight)})
    if(zip){
      const image=`images/${safeFilename(name)}.png`
      zip.file(image,await (await png(rendered)).arrayBuffer())
      manifest.push({key:layer.key,name,image,pixel:{x:left,y:top,width:drawWidth,height:drawHeight},tile:layer.tile,feather:layer.feather})
    }
    // Release each temporary canvas promptly; PSD owns only its required channel pixels.
    rendered.width=1;rendered.height=1
  }
  if(zip){
    zip.file('map_stitch_godot.json',JSON.stringify({version:1,coordinate_system:'top_left_origin_y_down_pixels',canvas:{width,height},
      source:{file:layout.sourceName,width:layout.width,height:layout.height},overlap:{horizontal_percent:layout.horizontalOverlapPercent,vertical_percent:layout.verticalOverlapPercent},tiles:manifest},null,2))
    zip.file('map_stitch_godot.tscn',godotSceneTscn(safeFilename(layout.sourceName.replace(/\.[^.]+$/,'')),manifest))
    return zip.generateAsync({type:'blob'})
  }
  if(format==='psd')return layeredPsdBlob(width,height,ctx!.getImageData(0,0,width,height),layers)
  return png(composite!)
}
