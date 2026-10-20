import {fineEditorDimensions} from '../lib/fineEditorPixels'
import {cacheManagedInput,importManagedInputs,loadManagedVersions,type ManagedVersion} from './managedTasks'
import {imageToolMetadata} from './imageToolDocument'
import {localFetch,localJson} from './api'
import type {OpticalFlowInterpolateOptions} from '../lib/opticalFlowInterpolate'

export type FlowResult={outputs:File[];report:File;inputs:File[];taskId:string}
export type FlowDraft={inputMode:'files'|'sheet';files:File[];sheet:File|null;columns:number;rows:number;
 options:OpticalFlowInterpolateOptions;sheetColumns:number;view:{sourcePage:number;resultPage:number;pageSize:number};
 normalizations:FlowResult[];split:FlowResult|null;flow:FlowResult|null;zip:FlowResult|null;sprite:FlowResult|null}
type Resource={versionId:string;name:string;type:string}
type StoredResult={outputs:Resource[];report:Resource;inputs:Resource[];taskId:string}
const stages=['split','flow','zip','sprite'] as const
type Stage=typeof stages[number]
export type StoredFlow=Omit<FlowDraft,'files'|'sheet'|'normalizations'|Stage>&{formatVersion:1;files:Resource[];sheet:Resource|null;normalizations:StoredResult[]}&Record<Stage,StoredResult|null>
type Task={state:string;results:string[];payload:{operation:string;inputs:string[];parameters:Record<string,unknown>}}
export const flowReports=new WeakMap<File,Record<string,unknown>>()
export const initialFlowDraft=():FlowDraft=>({inputMode:'files',files:[],sheet:null,columns:4,rows:1,
 options:{alpha:.5,nearestNeighbor:false,bidirectional:true,smoothFlow:true,quality:'balanced',maxMotionRelative:.35},
 sheetColumns:1,view:{sourcePage:1,resultPage:1,pageSize:24},normalizations:[],split:null,flow:null,zip:null,sprite:null})
const draftEntries=(d:FlowDraft)=>[...d.normalizations.map(r=>({kind:'normalize' as const,result:r})),...stages.flatMap(k=>d[k]?[{kind:k,result:d[k]!}]:[])]
const storedEntries=(d:StoredFlow)=>[...d.normalizations.map(r=>({kind:'normalize' as const,result:r})),...stages.flatMap(k=>d[k]?[{kind:k,result:d[k]!}]:[])]
export const flowFiles=(drafts:FlowDraft[])=>new Set(drafts.flatMap(d=>[...d.files,d.sheet,...draftEntries(d).flatMap(({result:r})=>[...r.outputs,r.report,...r.inputs])]).filter((f):f is File=>!!f))
export const flowNeedsBrowserDecode=(m:ManagedVersion['metadata'])=>m.containerFormat!=='PNG'||(m.orientation??1)!==1
export const sortFlowFiles=(files:File[])=>[...files].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}))
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const fields=(v:object,keys:string[])=>Object.keys(v).sort().join(',')===[...keys].sort().join(',')
const integer=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=a&&v<=b
const finite=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v)
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
const equal=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b))
const ids=(refs:Resource[])=>refs.map(r=>r.versionId)
const referenceKey=(r:Resource)=>r.versionId+'|'+r.name+'|'+r.type
function resource(v:unknown):asserts v is Resource{
 if(!object(v)||!fields(v,['versionId','name','type'])||!uuid(v.versionId)||typeof v.name!=='string'||!v.name.length||v.name.length>255||['.','..'].includes(v.name)||/[\\/]/.test(v.name)||[...v.name].some(c=>c.charCodeAt(0)<32)||typeof v.type!=='string'||v.type.length>100||[...v.type].some(c=>c.charCodeAt(0)<32))throw new Error('FLOW_DOCUMENT_RESOURCE')
}
export function validateFlowOptions(value:unknown):asserts value is OpticalFlowInterpolateOptions{
 if(!object(value)||!fields(value,Object.keys(initialFlowDraft().options))||!finite(value.alpha,0,1)||!finite(value.maxMotionRelative,.05,.95)||!['fast','balanced','high'].includes(String(value.quality))||['nearestNeighbor','bidirectional','smoothFlow'].some(k=>typeof value[k]!=='boolean'))throw new Error('FLOW_DOCUMENT_OPTIONS')
}
const references=(d:StoredFlow)=>[...d.files,d.sheet,...storedEntries(d).flatMap(({result:r})=>[...r.outputs,r.report,...r.inputs])].filter((r):r is Resource=>!!r)
export function validateStoredFlow(value:unknown):StoredFlow{
 if(object(value)&&fields(value,['formatVersion',...Object.keys(initialFlowDraft()).filter(k=>k!=='normalizations')]))value={...value,normalizations:[]}
 if(!object(value)||!fields(value,['formatVersion',...Object.keys(initialFlowDraft())])||value.formatVersion!==1||!['files','sheet'].includes(String(value.inputMode))||!Array.isArray(value.files)||value.files.length>1000||!integer(value.columns,1,64)||!integer(value.rows,1,64)||!integer(value.sheetColumns,1,1000))throw new Error('FLOW_DOCUMENT_FIELDS')
 value.files.forEach(resource);if(value.sheet!==null)resource(value.sheet);validateFlowOptions(value.options)
 const view=value.view
 if(!object(view)||!fields(view,['sourcePage','resultPage','pageSize'])||!integer(view.sourcePage,1,1000)||!integer(view.resultPage,1,1000)||!integer(view.pageSize,24,128)||![24,64,128].includes(Number(view.pageSize)))throw new Error('FLOW_DOCUMENT_VIEW')
 const d=value as StoredFlow
 if(!Array.isArray(d.normalizations)||d.normalizations.length>1001)throw new Error('FLOW_DOCUMENT_NORMALIZATIONS')
 for(const r of d.normalizations)if(!object(r))throw new Error('FLOW_DOCUMENT_RESULT')
 for(const k of stages)if(d[k]!==null&&!object(d[k]))throw new Error('FLOW_DOCUMENT_RESULT')
 for(const {kind:k,result:r} of storedEntries(d)){
  if(!object(r)||!fields(r,['outputs','report','inputs','taskId'])||!uuid(r.taskId)||!Array.isArray(r.outputs)||!integer(r.outputs.length,1,k==='split'?4096:k==='flow'?999:1)||!Array.isArray(r.inputs)||!integer(r.inputs.length,1,k==='split'||k==='normalize'?1:k==='flow'?500:1000))throw new Error('FLOW_DOCUMENT_RESULT')
  r.inputs.forEach(resource);r.outputs.forEach(resource);resource(r.report)
 }
 const roots=[...ids(d.files),...(d.sheet?[d.sheet.versionId]:[])],normalized=new Map<string,Resource>()
 for(const r of d.normalizations){const source=r.inputs[0].versionId;if(!roots.includes(source)||normalized.has(source)||r.outputs.length!==1)throw new Error('FLOW_DOCUMENT_NORMALIZATION_SOURCE');normalized.set(source,r.outputs[0])}
 const decoded=(r:Resource)=>normalized.get(r.versionId)??r
 if(d.split&&(d.inputMode!=='sheet'||!d.sheet||!equal(ids(d.split.inputs),[decoded(d.sheet).versionId])))throw new Error('FLOW_DOCUMENT_SPLIT_SOURCE')
 if(d.flow){
  const expected=d.inputMode==='sheet'?d.split?.outputs:d.files.map(decoded)
  if(!expected||expected.length<2||!equal(d.inputMode==='files'?[...ids(d.flow.inputs)].sort():ids(d.flow.inputs),d.inputMode==='files'?[...ids(expected)].sort():ids(expected)))throw new Error('FLOW_DOCUMENT_FLOW_SOURCE')
  if(d.flow.outputs.length!==d.flow.inputs.length*2-1)throw new Error('FLOW_DOCUMENT_FRAME_COUNT')
 }
 for(const k of ['zip','sprite'] as const)if(d[k]&&(!d.flow||!equal(ids(d[k]!.inputs),ids(d.flow.outputs))))throw new Error('FLOW_DOCUMENT_EXPORT_SOURCE')
 const results=storedEntries(d).map(e=>e.result),outputs=results.flatMap(r=>[...ids(r.outputs),r.report.versionId]),sources=roots
 if(new Set(results.map(r=>r.taskId)).size!==results.length||new Set(outputs).size!==outputs.length||outputs.some(id=>sources.includes(id)))throw new Error('FLOW_DOCUMENT_IDENTITY')
 const aliases=new Map<string,string>();for(const ref of references(d)){const key=referenceKey(ref);if(aliases.has(ref.versionId)&&aliases.get(ref.versionId)!==key)throw new Error('FLOW_DOCUMENT_ALIAS');aliases.set(ref.versionId,key)}
 return d
}
function encode(d:FlowDraft,ref:(f:File)=>Resource):StoredFlow{
 const result=(r:FlowResult)=>({...r,outputs:r.outputs.map(ref),inputs:r.inputs.map(ref),report:ref(r.report)})
 return validateStoredFlow({...d,formatVersion:1,files:d.files.map(ref),sheet:d.sheet?ref(d.sheet):null,normalizations:d.normalizations.map(result),...Object.fromEntries(stages.map(k=>[k,d[k]?result(d[k]!):null]))})
}
async function verify(d:StoredFlow,versions:Map<string,ManagedVersion>,budget:number){
 const reportIds=new Set(storedEntries(d).map(({result:r})=>r.report.versionId)),zipId=d.zip?.outputs[0].versionId,tasks=new Map<string,Task>()
 for(const [id,version] of versions){const m=version.metadata
  if(version.id!==id||!integer(m.bytes,1,budget/4))throw new Error('FLOW_DOCUMENT_METADATA')
  if(reportIds.has(id)?m.kind!=='document'||m.extension!=='.json'||m.bytes>8*1024**2:id===zipId?m.kind!=='archive'||m.extension!=='.zip':m.kind!=='image'||!integer(m.width,1,30000)||!integer(m.height,1,30000)||(m.frames??1)!==1||!['PNG','JPEG','WEBP'].includes(m.containerFormat??''))throw new Error('FLOW_DOCUMENT_METADATA')
 }
 for(const ref of [...d.files,...(d.sheet?[d.sheet]:[])])if(versions.get(ref.versionId)!.metadata.bytes>20*1024**2)throw new Error('FLOW_DOCUMENT_SOURCE_LIMIT')
 for(const {kind:k,result:r} of storedEntries(d)){
  const t=await localJson<Task>(`/api/tasks/${r.taskId}`),p=t.payload.parameters,operation=k==='normalize'?'image.flowNormalize':k==='split'?'image.flowSplit':k==='flow'?'sequence.opticalFlow':'sequence.flowExport'
  if(t.state!=='succeeded'||t.payload.operation!==operation||!equal(t.payload.inputs,ids(r.inputs))||!equal(t.results,[...ids(r.outputs),r.report.versionId])||!object(p)||!integer(p.frontendBytes,0,2*1024**3))throw new Error('FLOW_DOCUMENT_TASK')
  const input=r.inputs.map(ref=>versions.get(ref.versionId)!.metadata),out=r.outputs.map(ref=>versions.get(ref.versionId)!.metadata)
  if(k!=='normalize'&&input.some(flowNeedsBrowserDecode))throw new Error('FLOW_DOCUMENT_BROWSER_DECODE_REQUIRED')
  if(k==='normalize'){
   const s=fineEditorDimensions(input[0]);if(!fields(p,['width','height','renderer','frontendBytes'])||p.renderer!=='browser-worker'||p.width!==s.width||p.height!==s.height||out[0].width!==s.width||out[0].height!==s.height)throw new Error('FLOW_DOCUMENT_NORMALIZATION_DIMENSIONS')
  }else if(k==='split'){
   if(!fields(p,['columns','rows','frontendBytes'])||!integer(p.columns,1,64)||!integer(p.rows,1,64)||out.length!==Number(p.columns)*Number(p.rows))throw new Error('FLOW_DOCUMENT_SPLIT')
   const s=fineEditorDimensions(input[0]),cols=Number(p.columns),rows=Number(p.rows)
   for(const [i,m] of out.entries()){const col=i%cols,row=Math.floor(i/cols),w=Math.max(1,Math.floor((col+1)*s.width!/cols)-Math.floor(col*s.width!/cols)),h=Math.max(1,Math.floor((row+1)*s.height!/rows)-Math.floor(row*s.height!/rows));if(m.width!==w||m.height!==h)throw new Error('FLOW_DOCUMENT_SPLIT_DIMENSIONS')}
  }else if(k==='flow'){
   if(!fields(p,[...Object.keys(initialFlowDraft().options),'frontendBytes']))throw new Error('FLOW_DOCUMENT_OPTIONS')
   const {frontendBytes:_,...options}=p;void _;validateFlowOptions(options)
   const size=fineEditorDimensions(input[0]);if(input.some(m=>{const s=fineEditorDimensions(m);return s.width!==size.width||s.height!==size.height})||out.some(m=>m.width!==size.width||m.height!==size.height))throw new Error('FLOW_DOCUMENT_FLOW_DIMENSIONS')
  }else{
   if(!fields(p,['columns','format','frontendBytes'])||p.format!==(k==='zip'?'zip':'sheet')||!integer(p.columns,1,1000))throw new Error('FLOW_DOCUMENT_EXPORT')
   if(k==='sprite'){const cols=Math.min(input.length,Number(p.columns)),s=input[0];if(out[0].width!==s.width!*cols||out[0].height!==s.height!*Math.ceil(input.length/cols))throw new Error('FLOW_DOCUMENT_EXPORT_DIMENSIONS')}
  }
  if(out.some((m,i)=>!(k==='zip'&&i===0)&&(m.extension!=='.png'||m.containerFormat!=='PNG'||(m.orientation??1)!==1)))throw new Error('FLOW_DOCUMENT_OUTPUT_FORMAT')
  tasks.set(r.taskId,t)
 }
 return tasks
}
async function checkReports(d:FlowDraft,tasks:Map<string,Task>){
 for(const {kind:k,result:r} of draftEntries(d)){const t=tasks.get(r.taskId)!,report=JSON.parse(await r.report.text()) as Record<string,unknown>
  if(!object(report)||report.operation!==t.payload.operation||!equal(report.parameters,t.payload.parameters))throw new Error('FLOW_DOCUMENT_REPORT')
  if(k==='normalize'){
   if(report.method!=='original-host-canvas-worker'||report.outputFrames!==1)throw new Error('FLOW_DOCUMENT_NORMALIZATION_REPORT')
  }else if(k==='split'){
   if(report.method!=='original-advanced-pixel-grid-export'||report.outputFrames!==r.outputs.length||!Array.isArray(report.frameDimensions)||report.frameDimensions.length!==r.outputs.length||report.frameDimensions.some((m,i)=>!object(m)||m.width!==imageToolMetadata.get(r.outputs[i])!.metadata.width||m.height!==imageToolMetadata.get(r.outputs[i])!.metadata.height))throw new Error('FLOW_DOCUMENT_REPORT')
  }else if(k==='flow'){
   const m=imageToolMetadata.get(r.outputs[0])!.metadata
   if(report.method!=='original-opencv-farneback'||report.inputFrames!==r.inputs.length||report.outputFrames!==r.outputs.length||!equal(report.processingDimensions,{width:m.width,height:m.height}))throw new Error('FLOW_DOCUMENT_REPORT')
  }else{
   if(report.method!=='original-advanced-pixel-grid-export'||report.frameCount!==r.inputs.length||report.format!==(k==='zip'?'zip':'sheet'))throw new Error('FLOW_DOCUMENT_REPORT')
   if(k==='sprite'){const m=imageToolMetadata.get(r.outputs[0])!.metadata;if(report.width!==m.width||report.height!==m.height||report.columns!==Math.min(r.inputs.length,Number(t.payload.parameters.columns)))throw new Error('FLOW_DOCUMENT_REPORT')}
  }
  flowReports.set(r.report,report)
 }
}
export async function serializeFlow(d:FlowDraft):Promise<StoredFlow>{
 const files=[...flowFiles([d])],fake=new Map(files.map((f,i)=>[f,{versionId:`00000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`,name:f.name,type:f.type}]))
 encode(d,f=>fake.get(f)!)
 const {versions,memoryBudgetBytes}=await importManagedInputs(files);files.forEach((f,i)=>imageToolMetadata.set(f,versions[i]))
 const stored=encode(d,f=>({versionId:imageToolMetadata.get(f)!.id,name:f.name,type:f.type})),tasks=await verify(stored,new Map(versions.map(v=>[v.id,v])),memoryBudgetBytes)
 await checkReports(d,tasks);return stored
}
export async function restoreFlow(value:unknown,retained:File[]=[]):Promise<FlowDraft>{
 const d=validateStoredFlow(value),{project,memoryBudgetBytes}=await localJson<{project:{id:string};memoryBudgetBytes:number}>('/api/project/context')
 if(!integer(memoryBudgetBytes,1,2*1024**3))throw new Error('FLOW_DOCUMENT_BUDGET')
 const refs=[...new Map(references(d).map(r=>[referenceKey(r),r])).values()],versions=new Map((await loadManagedVersions([...new Set(refs.map(r=>r.versionId))])).map(v=>[v.id,v]))
 const bytes=[...new Set(retained)].reduce((n,f)=>n+f.size*2,0)+refs.reduce((n,r)=>n+(versions.get(r.versionId)?.metadata.bytes??NaN)*2+(versions.get(r.versionId)?.metadata.thumbnailDataUrl?.length??0)*2,0)
 if(!integer(bytes,0,memoryBudgetBytes/4))throw new Error('FLOW_DOCUMENT_BUDGET')
 const tasks=await verify(d,versions,memoryBudgetBytes),loaded=new Map<string,File>();let next=0
 await Promise.all(Array.from({length:Math.min(8,refs.length)},async()=>{while(next<refs.length){const r=refs[next++],response=await localFetch(`/api/versions/${r.versionId}/content`);if(!response.ok)throw new Error('FLOW_DOCUMENT_MISSING');const blob=await response.blob(),v=versions.get(r.versionId)!
  if(blob.size!==v.metadata.bytes)throw new Error('FLOW_DOCUMENT_RESOURCE_SIZE');const f=new File([blob],r.name,{type:r.type});imageToolMetadata.set(f,v);cacheManagedInput(f,project.id,r.versionId);loaded.set(referenceKey(r),f)
 }}))
 const file=(r:Resource)=>loaded.get(referenceKey(r))!,result=(r:StoredResult|null):FlowResult|null=>r?{outputs:r.outputs.map(file),inputs:r.inputs.map(file),report:file(r.report),taskId:r.taskId}:null
 const draft:FlowDraft={inputMode:d.inputMode,files:d.files.map(file),sheet:d.sheet?file(d.sheet):null,columns:d.columns,rows:d.rows,options:d.options,sheetColumns:d.sheetColumns,view:d.view,normalizations:d.normalizations.map(r=>result(r)!),split:result(d.split),flow:result(d.flow),zip:result(d.zip),sprite:result(d.sprite)}
 await checkReports(draft,tasks);return draft
}
