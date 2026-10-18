import {checkMatteToolBudget,validateMatteToolLayout,type MatteToolLayout} from '../lib/matteTool'
import {fineEditorDimensions} from '../lib/fineEditorPixels'
import {imageToolMetadata} from './imageToolDocument'
import {importManagedInputs,cacheManagedInput,loadManagedVersions,type ManagedVersion} from './managedTasks'
import {localFetch,localJson} from './api'

export type MatteSettings={keyColor:string;tolerance:number;smoothness:number;spill:number;erosion:number;doubleTolerance:number;edgeContrast:number;postErosion:number}
export type MatteView={backgroundActive:boolean;background:string;zoom:number;panX:number;panY:number}
export type MatteResult={file:File;inputs:File[];report:File;taskId:string}
export type MatteDraft={mode:'chroma'|'whiteErode'|'doubleBg';settings:MatteSettings;view:MatteView;source:File|null;black:File|null;white:File|null;raw:MatteResult|null;repaired:MatteResult|null;eroded:MatteResult|null}
type Resource={versionId:string;name:string;type:string}
type StoredResult={file:Resource;inputs:Resource[];report:Resource;taskId:string}
export type StoredMatte=Omit<MatteDraft,'source'|'black'|'white'|'raw'|'repaired'|'eroded'>&{formatVersion:1;source:Resource|null;black:Resource|null;white:Resource|null;raw:StoredResult|null;repaired:StoredResult|null;eroded:StoredResult|null}
export const matteSettings:MatteSettings={keyColor:'#00ff00',tolerance:35,smoothness:34,spill:75,erosion:77,doubleTolerance:70,edgeContrast:53,postErosion:0}
export const initialMatteDraft=():MatteDraft=>({mode:'doubleBg',settings:{...matteSettings},view:{backgroundActive:true,background:'#37634d',zoom:1,panX:0,panY:0},source:null,black:null,white:null,raw:null,repaired:null,eroded:null})
export const matteReports=new WeakMap<File,Record<string,unknown>>()
export const matteInputs=(d:MatteDraft)=>(d.mode==='doubleBg'?[d.black,d.white]:[d.source]).filter((f):f is File=>!!f)
export function matteLayout(d:Pick<MatteDraft,'mode'|'settings'>):MatteToolLayout{
 const p=d.settings
 return d.mode==='doubleBg'?{mode:d.mode,tolerance:p.doubleTolerance,edgeContrast:p.edgeContrast}:d.mode==='whiteErode'?{mode:d.mode,tolerance:p.tolerance,smoothness:p.smoothness,erosion:p.erosion}:{mode:d.mode,keyColor:p.keyColor,tolerance:p.tolerance,smoothness:p.smoothness,spill:p.spill,erosion:p.erosion}
}
export const matteFiles=(drafts:MatteDraft[])=>new Set(drafts.flatMap(d=>[d.source,d.black,d.white,...[d.raw,d.repaired,d.eroded].flatMap(r=>r?[r.file,...r.inputs,r.report]:[])]).filter((f):f is File=>!!f))
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const fields=(v:object,keys:string[])=>Object.keys(v).sort().join(',')===[...keys].sort().join(',')
const integer=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max
const finite=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v)
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
const equal=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b))
function resource(v:unknown):asserts v is Resource{
 if(!object(v)||!fields(v,['versionId','name','type'])||!uuid(v.versionId)||typeof v.name!=='string'||!v.name.length||v.name.length>255||['.','..'].includes(v.name)||/[\\/]/.test(v.name)||[...v.name].some(c=>c.charCodeAt(0)<32)||typeof v.type!=='string'||v.type.length>100||[...v.type].some(c=>c.charCodeAt(0)<32))throw new Error('MATTE_DOCUMENT_RESOURCE')
}
export function validateStoredMatte(value:unknown):StoredMatte{
 if(!object(value)||!fields(value,['formatVersion','mode','settings','view','source','black','white','raw','repaired','eroded'])||value.formatVersion!==1||typeof value.mode!=='string'||!['chroma','whiteErode','doubleBg'].includes(value.mode))throw new Error('MATTE_DOCUMENT_FIELDS')
 const p=value.settings,v=value.view
 if(!object(p)||!fields(p,Object.keys(matteSettings))||!object(v)||!fields(v,['backgroundActive','background','zoom','panX','panY'])||typeof v.backgroundActive!=='boolean'||typeof v.background!=='string'||!/^#[a-f\d]{6}$/i.test(v.background)||!finite(v.zoom,.1,5)||!finite(v.panX,-1e6,1e6)||!finite(v.panY,-1e6,1e6))throw new Error('MATTE_DOCUMENT_SETTINGS')
 validateMatteToolLayout({mode:'chroma',keyColor:p.keyColor,tolerance:p.tolerance,smoothness:p.smoothness,spill:p.spill,erosion:p.erosion})
 validateMatteToolLayout({mode:'doubleBg',tolerance:p.doubleTolerance,edgeContrast:p.edgeContrast});validateMatteToolLayout({mode:'frontier',erosion:p.postErosion})
 for(const ref of [value.source,value.black,value.white])if(ref!==null)resource(ref)
 if(value.mode==='doubleBg'?value.source!==null:value.black!==null||value.white!==null)throw new Error('MATTE_DOCUMENT_MODE_INPUTS')
 const d=value as StoredMatte
 for(const r of [d.raw,d.repaired,d.eroded])if(r!==null){
  if(!object(r)||!fields(r,['file','inputs','report','taskId'])||!uuid(r.taskId)||!Array.isArray(r.inputs)||r.inputs.length<1||r.inputs.length>2)throw new Error('MATTE_DOCUMENT_RESULT')
  resource(r.file);resource(r.report);r.inputs.forEach(resource)
 }
 if(d.repaired&&(!d.raw||d.mode!=='doubleBg')||d.eroded&&!d.repaired)throw new Error('MATTE_DOCUMENT_CHAIN')
 const rawInputs=(d.mode==='doubleBg'?[d.black,d.white]:[d.source]).filter((r):r is Resource=>!!r)
 if(d.raw&&(rawInputs.length!==(d.mode==='doubleBg'?2:1)||!equal(d.raw.inputs.map(r=>r.versionId),rawInputs.map(r=>r.versionId))))throw new Error('MATTE_DOCUMENT_RAW_INPUTS')
 if(d.repaired&&!equal(d.repaired.inputs.map(r=>r.versionId),[d.raw!.file.versionId])||d.eroded&&!equal(d.eroded.inputs.map(r=>r.versionId),[d.repaired!.file.versionId]))throw new Error('MATTE_DOCUMENT_CHAIN')
 const results=[d.raw,d.repaired,d.eroded].filter((r):r is StoredResult=>!!r),outputs=results.flatMap(r=>[r.file.versionId,r.report.versionId])
 if(new Set(results.map(r=>r.taskId)).size!==results.length||new Set(outputs).size!==outputs.length||outputs.some(id=>rawInputs.some(r=>r.versionId===id)))throw new Error('MATTE_DOCUMENT_IDENTITY')
 return d
}
const references=(d:StoredMatte)=>[d.source,d.black,d.white,...[d.raw,d.repaired,d.eroded].flatMap(r=>r?[r.file,...r.inputs,r.report]:[])].filter((r):r is Resource=>!!r)
const key=(r:Resource)=>r.versionId+'|'+r.name+'|'+r.type
type Task={state:string;results:string[];payload:{operation:string;inputs:string[];parameters:{layout:MatteToolLayout;renderer:string;frontendBytes:number}}}
async function verify(d:StoredMatte,versions:Map<string,ManagedVersion>,budget:number){
 const reports=new Set([d.raw,d.repaired,d.eroded].filter(Boolean).map(r=>r!.report.versionId)),tasks=new Map<string,Task>()
 for(const version of versions.values()){
  const m=version.metadata
  const invalidKind=reports.has(version.id)?m.kind!=='document'||m.extension!=='.json'||m.bytes>8*1024**2:m.kind!=='image'||!integer(m.width,1,30000)||!integer(m.height,1,30000)
  if(!integer(m.bytes,1,budget/4)||invalidKind)throw new Error('MATTE_DOCUMENT_METADATA')
 }
 for(const r of [d.source,d.black,d.white])if(r){const m=versions.get(r.versionId)!.metadata;if(m.bytes>20*1024**2||!['PNG','JPEG','WEBP'].includes(m.containerFormat??'')||(m.frames??1)!==1)throw new Error('MATTE_DOCUMENT_SOURCE')}
 for(const [role,r] of [['raw',d.raw],['repaired',d.repaired],['eroded',d.eroded]] as const)if(r){
  const t=await localJson<Task>(`/api/tasks/${r.taskId}`),p=t.payload?.parameters
  if(t.state!=='succeeded'||t.payload.operation!=='image.matteTool'||!equal(t.payload.inputs,r.inputs.map(i=>i.versionId))||!equal(t.results,[r.file.versionId,r.report.versionId])||!p||!fields(p,['layout','renderer','frontendBytes'])||p.renderer!=='browser-worker'||!integer(p.frontendBytes,0,2*1024**3))throw new Error('MATTE_DOCUMENT_TASK')
  validateMatteToolLayout(p.layout)
  if(p.layout.mode!==(role==='raw'?d.mode:role==='repaired'?'repair':'frontier'))throw new Error('MATTE_DOCUMENT_ROLE')
  const inputs=r.inputs.map(i=>versions.get(i.versionId)!.metadata),sizes=inputs.map(m=>({...fineEditorDimensions(m),bytes:m.bytes})) as {width:number;height:number;bytes:number}[]
  checkMatteToolBudget(sizes,p.layout,budget,0)
  const m=versions.get(r.file.versionId)!.metadata
  if(m.kind!=='image'||m.containerFormat!=='PNG'||m.extension!=='.png'||(m.frames??1)!==1||(m.orientation??1)!==1||m.bytes>128*1024**2||m.width!==sizes[0].width||m.height!==sizes[0].height)throw new Error('MATTE_DOCUMENT_OUTPUT')
  tasks.set(r.taskId,t)
 }
 return tasks
}
async function checkReports(d:MatteDraft,tasks:Map<string,Task>){
 for(const r of [d.raw,d.repaired,d.eroded])if(r){const report=JSON.parse(await r.report.text()),p=tasks.get(r.taskId)!.payload.parameters,m=imageToolMetadata.get(r.file)!.metadata
  if(!object(report)||report.operation!=='image.matteTool'||report.mode!==p.layout.mode||report.width!==m.width||report.height!==m.height||report.outputFrames!==1||!equal(report.parameters,p))throw new Error('MATTE_DOCUMENT_REPORT')
  matteReports.set(r.report,report)
 }
}
function encodeMatte(d:MatteDraft,ref:(file:File)=>Resource){
 const result=(r:MatteResult|null):StoredResult|null=>r?{file:ref(r.file),inputs:r.inputs.map(ref),report:ref(r.report),taskId:r.taskId}:null
 return validateStoredMatte({...d,formatVersion:1,source:d.source?ref(d.source):null,black:d.black?ref(d.black):null,white:d.white?ref(d.white):null,raw:result(d.raw),repaired:result(d.repaired),eroded:result(d.eroded)})
}
export async function serializeMatte(d:MatteDraft):Promise<StoredMatte>{
 const files=[...matteFiles([d])],placeholders=new Map(files.map((f,i)=>[f,{versionId:`00000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`,name:f.name,type:f.type}]))
 encodeMatte(d,file=>placeholders.get(file)!)
 const {versions,memoryBudgetBytes}=await importManagedInputs(files)
 files.forEach((f,i)=>imageToolMetadata.set(f,versions[i]))
 const stored=encodeMatte(d,f=>({versionId:imageToolMetadata.get(f)!.id,name:f.name,type:f.type}))
 const tasks=await verify(stored,new Map(versions.map(v=>[v.id,v])),memoryBudgetBytes);await checkReports(d,tasks);return stored
}
export async function restoreMatte(value:unknown,retained:File[]=[]):Promise<MatteDraft>{
 const stored=validateStoredMatte(value),{project,memoryBudgetBytes}=await localJson<{project:{id:string};memoryBudgetBytes:number}>('/api/project/context')
 if(!integer(memoryBudgetBytes,1,2*1024**3))throw new Error('MATTE_DOCUMENT_BUDGET')
 const refs=[...new Map(references(stored).map(r=>[key(r),r])).values()],versions=new Map((await loadManagedVersions([...new Set(refs.map(r=>r.versionId))])).map(v=>[v.id,v]))
 const bytes=[...new Set(retained)].reduce((n,f)=>n+f.size*2,0)+refs.reduce((n,r)=>n+(versions.get(r.versionId)?.metadata.bytes??NaN)*2,0)
 if(!integer(bytes,0,memoryBudgetBytes/4))throw new Error('MATTE_DOCUMENT_BUDGET')
 const tasks=await verify(stored,versions,memoryBudgetBytes),files=new Map<string,File>()
 for(const r of refs){const response=await localFetch(`/api/versions/${r.versionId}/content`);if(!response.ok)throw new Error('MATTE_DOCUMENT_MISSING');const blob=await response.blob(),v=versions.get(r.versionId)!
  if(blob.size!==v.metadata.bytes)throw new Error('MATTE_DOCUMENT_RESOURCE_SIZE')
  const file=new File([blob],r.name,{type:r.type});imageToolMetadata.set(file,v);cacheManagedInput(file,project.id,r.versionId);files.set(key(r),file)
 }
 const file=(r:Resource|null)=>r?files.get(key(r))!:null,result=(r:StoredResult|null):MatteResult|null=>r?{file:file(r.file)!,inputs:r.inputs.map(r=>file(r)!),report:file(r.report)!,taskId:r.taskId}:null
 const draft:MatteDraft={mode:stored.mode,settings:stored.settings,view:stored.view,source:file(stored.source),black:file(stored.black),white:file(stored.white),raw:result(stored.raw),repaired:result(stored.repaired),eroded:result(stored.eroded)}
 await checkReports(draft,tasks);return draft
}
