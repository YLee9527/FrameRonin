import JSZip from '../assets/workbench/node_modules/jszip'
import {cacheManagedInput,importManagedInputs,runManagedTask} from '../assets/workbench/src/localProject/managedTasks'
import {inspectSelectedVideo} from '../assets/workbench/src/lib/browserVideoCapture'
import {jsonPost,localFetch,localJson} from '../assets/workbench/src/localProject/api'
import {imageToolMetadata} from '../assets/workbench/src/localProject/imageToolDocument'
import {initialVideoDraft,serializeVideo,restoreVideo,type VideoResult} from '../assets/workbench/src/localProject/videoDocument'
import {createVideoHistory,videoHistoryReducer} from '../assets/workbench/src/localProject/useVideoDocument'

const all=document.querySelector<HTMLButtonElement>('#all')!,long=document.querySelector<HTMLButtonElement>('#long')!,cancel=document.querySelector<HTMLButtonElement>('#cancel')!,status=document.querySelector<HTMLElement>('#status')!,decoder=document.querySelector<HTMLElement>('#decoder')!,results=document.querySelector<HTMLElement>('#results')!,progress=document.querySelector<HTMLProgressElement>('#progress')!,download=document.querySelector<HTMLAnchorElement>('#download')!
let controller:AbortController|null=null,url:string|null=null,requestedAt:number|null=null
const files=new Map<string,File>()
cancel.addEventListener('click',()=>{requestedAt=Date.now();controller?.abort()})
async function source(name:string){
 let file=files.get(name)
 if(!file){const response=await fetch('/acceptance/'+(name==='cancel-long.mp4'?name:'video-capture/'+name));if(!response.ok)throw new Error('Fixture missing');file=new File([await response.blob()],name,{type:response.headers.get('content-type')??'video/mp4'});files.set(name,file)}
 return file
}
async function publish(zip:JSZip,name:string){if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(await zip.generateAsync({type:'blob'}));download.href=url;download.download=name;download.hidden=false}
async function run(longSample:boolean){
 if(controller)return
 const abort=new AbortController();controller=abort;requestedAt=null;all.disabled=true;long.disabled=true;cancel.disabled=false;download.hidden=true;results.textContent='';progress.value=0
 let activeId:string|null=null
 try{
  const fixture=await(await fetch('/acceptance/video-capture/manifest.json')).json(),entries=longSample?[{id:'managed-cancel',source:'cancel-long.mp4',parameters:{start:0,end:30,fps:60,maxFrames:2000,crop:{left:0,top:0,right:0,bottom:0}}}]:fixture.cases
  const zip=new JSZip(),records:object[]=[]
  for(const entry of entries){
   activeId=null
   status.textContent='Preparing '+entry.id;progress.value=0
   const file=await source(entry.source),imported=await importManagedInputs([file],abort.signal),m=imported.versions[0].metadata
   const limits={budget:imported.memoryBudgetBytes,frontendBytes:file.size*2,physical:{width:m.width!,height:m.height!}}
   let info
   try{info=await inspectSelectedVideo(file,limits,abort.signal)}catch(error){
    const code=String(error).match(/VIDEO_DECODE_FAILED: ([34])/)
    if(!code)throw error
    const rejected={sample:entry.id,source:entry.source,rejected:true,mediaCode:Number(code[1]),sourceVersion:imported.inputs[0],taskCreated:false}
    records.push(rejected);zip.file(entry.id+'/actual.json',JSON.stringify({rejected:true,mediaCode:Number(code[1])}));results.textContent=JSON.stringify(records,null,2);continue
   }
   const layout={...entry.parameters,end:longSample?info.duration:entry.parameters.end,sourceWidth:info.width,sourceHeight:info.height}
   const result=await runManagedTask('video.capture',[file],{renderer:'browser-worker',frontendBytes:limits.frontendBytes,layout},{signal:abort.signal,onTask:id=>{activeId=id},onProgress:p=>{progress.value=Math.max(progress.value,p);status.textContent=`Capturing ${entry.id}: ${Math.round(progress.value*100)}%`;decoder.textContent='Owned decoder elements: '+document.querySelectorAll('[data-frameronin-capture]').length}})
   if(result.outputs.length!==2)throw new Error('Unexpected capture output count')
   const report=JSON.parse(await result.outputs[1].blob.text())
   zip.file(entry.id+'/actual.zip',result.outputs[0].blob);zip.file(entry.id+'/actual.json',JSON.stringify({info,width:report.width,height:report.height,cropWidth:report.cropWidth,cropHeight:report.cropHeight,timestamps:report.timestamps}))
   records.push({sample:entry.id,source:entry.source,taskId:result.taskId,results:result.outputs.map(o=>o.version.id),frames:report.outputFrames});results.textContent=JSON.stringify(records,null,2)
  }
  zip.file('tasks.json',JSON.stringify(records,null,2));await publish(zip,'managed-video-capture.zip');status.textContent=`Managed capture complete: ${entries.length} samples`;decoder.textContent='Owned decoder elements: '+document.querySelectorAll('[data-frameronin-capture]').length
 }catch(error){
  decoder.textContent='Owned decoder elements: '+document.querySelectorAll('[data-frameronin-capture]').length
  if(error instanceof DOMException&&error.name==='AbortError'){
   const record=activeId?await localJson(`/api/tasks/${activeId}`):null,zip=new JSZip(),result={taskId:activeId,feedbackMs:requestedAt===null?null:Date.now()-requestedAt,ownedDecoders:document.querySelectorAll('[data-frameronin-capture]').length,record}
   zip.file('cancellation.json',JSON.stringify(result,null,2));await publish(zip,'managed-video-cancel.zip');results.textContent=JSON.stringify(result,null,2);status.textContent='Managed capture canceled'
  }else{status.textContent='Managed capture failed: '+String(error);throw error}
 }finally{all.disabled=false;long.disabled=false;cancel.disabled=true;controller=null}
}
all.addEventListener('click',()=>{void run(false).catch(error=>console.error(String(error)))})
long.addEventListener('click',()=>{void run(true).catch(error=>console.error(String(error)))})
async function runDocument(){
 if(controller)return
 const abort=new AbortController();controller=abort;all.disabled=true;long.disabled=true;cancel.disabled=false;download.hidden=true;results.textContent=''
 const button=document.querySelector<HTMLButtonElement>('#document')!;button.disabled=true
 const check=(ok:boolean,message:string)=>{if(!ok)throw new Error(message)}
 try{
  const file=await source('h264.mp4'),imported=await importManagedInputs([file],abort.signal),m=imported.versions[0].metadata
  const info=await inspectSelectedVideo(file,{budget:imported.memoryBudgetBytes,frontendBytes:0,physical:{width:m.width!,height:m.height!}},abort.signal)
  const execute=async(operation:string,inputs:File[],layout:object):Promise<VideoResult>=>{
   status.textContent=`Document task: ${operation} ${'mode'in layout?layout.mode:'capture'}`
   const result=await runManagedTask(operation,inputs,{renderer:'browser-worker',frontendBytes:0,layout},{signal:abort.signal,onProgress:p=>{progress.value=p}})
   check(result.outputs.length===2,'Unexpected result list')
   const outputs=result.outputs.map(o=>{const f=new File([o.blob],o.version.name!,{type:o.blob.type});cacheManagedInput(f,result.project.id,o.version.id);imageToolMetadata.set(f,o.version);return f})
   return {data:outputs[0],report:outputs[1],inputs,taskId:result.taskId}
  }
  const layout={sourceWidth:info.width,sourceHeight:info.height,start:0,end:1,fps:10,maxFrames:300,crop:{left:0,top:0,right:0,bottom:0}},capture=await execute('video.capture',[file],layout),captureReport=JSON.parse(await capture.report.text())
  const analysis=await execute('video.frameTools',[capture.data],{mode:'analyze'}),zip=new JSZip(),records:object[]=[]
  for(const masked of [false,true]){
   // A tiny synthetic mask comes from an already captured PNG. This validates
   // the formal mask-input chain, not hand-drawing or visual brush quality.
   const captured=masked?await JSZip.loadAsync(capture.data):null
   const mask=masked?new File([await captured!.file('frame_000.png')!.async('blob')],'document-test-mask.png',{type:'image/png'}):null
   const selected=[0,2,8],processed=await execute('video.frameTools',[capture.data,...(mask?[mask]:[])],masked?{mode:'matte',selected,background:'#ffffff',tolerance:40,feather:10,mask:true}:{mode:'select',selected})
   const compose={mode:'compose',width:44,height:32,padding:2,spacing:1,columns:2,timestamps:selected.map(i=>captureReport.timestamps[i]),strokeWidth:0,strokeColor:'#000000'}
   const rawSheet=await execute('video.frameTools',[processed.data],compose),styledSheet=await execute('video.frameTools',[processed.data],{...compose,strokeWidth:1.5,strokeColor:'#995522'})
   const rawDownload=await execute('video.frameTools',[capture.data],{mode:'archive',selected:Array.from({length:11},(_,i)=>i),kind:'extracted'}),processedDownload=await execute('video.frameTools',[processed.data],{mode:'archive',selected:[0,1,2],kind:'matted'})
   let draft={...initialVideoDraft(),source:file,info,capture,analysis,processed,rawSheet,styledSheet,rawDownload,processedDownload,mask,frameCount:11,frameSize:{w:64,h:48},selected:[1,3]}
   draft={...draft,settings:{...draft.settings,start:.2,end:.8,crop:{left:1.5,top:2.25,right:3.75,bottom:4.5},exportName:masked?'带遮罩的角色':'跳过抠图的角色'}}
   const before=await localJson<{assets:{id:string;current_version:string}[]}>('/api/project'),tasksBefore=await localJson<object[]>('/api/tasks')
   status.textContent='Serializing and reopening '+(masked?'masked':'skip-matte')+' video document'
   const stored=await serializeVideo(draft),key=crypto.randomUUID(),copy=crypto.randomUUID()
   await localJson(`/api/documents/${key}`,jsonPost({kind:'video',revision:0,payload:stored}))
   const saved=await localJson<{payload:unknown;revision:number}>(`/api/documents/${key}`),restored=await restoreVideo(saved.payload),again=await serializeVideo(restored)
   check(JSON.stringify(stored)===JSON.stringify(again),'Restored immutable references changed')
   check(restored.capture!.inputs[0]===restored.source&&restored.processed!.inputs[0]===restored.capture!.data&&restored.styledSheet!.inputs[0]===restored.processed!.data,'Restored file identity changed')
   let history=createVideoHistory(restored)
   history=videoHistoryReducer(history,{type:'change',update:d=>({...d,styledSheet:null})});history=videoHistoryReducer(history,{type:'undo'})
   check(history.present.styledSheet===restored.styledSheet,'Undo should restore existing version')
   history=videoHistoryReducer(history,{type:'redo'});check(history.present.styledSheet===null,'Redo should switch result only')
   await localJson(`/api/documents/${copy}`,jsonPost({kind:'video',revision:0,payload:again}))
   const conflict=await localFetch(`/api/documents/${key}`,jsonPost({kind:'video',revision:0,payload:again}));check(conflict.status===400,'Stale revision unexpectedly accepted')
   const after=await localJson<{assets:{id:string;current_version:string}[]}>('/api/project'),tasksAfter=await localJson<object[]>('/api/tasks')
   const signature=(v:typeof before)=>v.assets.map(a=>[a.id,a.current_version])
   check(JSON.stringify(signature(before))===JSON.stringify(signature(after))&&tasksBefore.length===tasksAfter.length,'Save/reopen/history created processing work or versions')
   const record={masked,documentId:key,copyDocumentId:copy,revision:saved.revision,conflictStatus:conflict.status,taskIds:[capture,analysis,processed,rawSheet,styledSheet,rawDownload,processedDownload].map(r=>r.taskId),sourceVersion:stored.source!.versionId,reopenedReferencesEqual:true,noAdditionalTasksOrAssets:true}
   records.push(record);zip.file(`${masked?'masked':'skip'}/document.json`,JSON.stringify(stored,null,2));results.textContent=JSON.stringify(records,null,2)
  }
  zip.file('documents.json',JSON.stringify(records,null,2));await publish(zip,'managed-video-documents.zip');status.textContent='Video documents complete: 2 real task lineages';decoder.textContent='Owned decoder elements: '+document.querySelectorAll('[data-frameronin-capture]').length
 }catch(error){status.textContent='Video document failed: '+String(error);throw error}
 finally{controller=null;all.disabled=false;long.disabled=false;cancel.disabled=true;button.disabled=false}
}
document.querySelector<HTMLButtonElement>('#document')!.addEventListener('click',()=>{void runDocument().catch(error=>console.error(String(error)))})
