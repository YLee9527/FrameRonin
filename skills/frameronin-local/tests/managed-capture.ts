import JSZip from '../assets/workbench/node_modules/jszip'
import {importManagedInputs,runManagedTask} from '../assets/workbench/src/localProject/managedTasks'
import {inspectSelectedVideo} from '../assets/workbench/src/lib/browserVideoCapture'
import {localJson} from '../assets/workbench/src/localProject/api'

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
