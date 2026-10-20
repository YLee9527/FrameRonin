/** Read already-saved flow documents through production lineage/serializers.
 * Metadata POST is read-only. No imports, processing or document writes allowed.
 */
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {restoreFlow,serializeFlow,validateStoredFlow} from '../.runtime/js/algorithms.mjs'
const args=process.argv.slice(2),baseIndex=args.indexOf('--base'),outputIndex=args.indexOf('--output')
assert(baseIndex>=0&&outputIndex>=0,'Pass --base <owned-loopback-url> --output <json>')
const base=new URL(args[baseIndex+1]);assert(base.protocol==='http:'&&['127.0.0.1','localhost'].includes(base.hostname)&&Number(base.port)>=1024&&Number(base.port)<=65535&&base.pathname==='/'&&!base.username&&!base.password&&!base.search&&!base.hash)
const native=globalThis.fetch;let reads=0,metadataPosts=0
globalThis.fetch=(input,init={})=>{
 assert(typeof input==='string'&&input.startsWith('/api/'))
 const method=(init.method??'GET').toUpperCase()
 assert(method==='GET'||method==='POST'&&input==='/api/versions/manifest','Verification must not import assets, start tasks or save documents')
 if(method==='POST')metadataPosts++;else reads++
 const headers=new Headers(init.headers);if(method==='POST')headers.set('Origin',base.origin)
 return native(new URL(input,base),{...init,headers})
}
const get=async path=>{const response=await fetch(path);assert(response.ok);return response.json()}
try{
 const before=await get('/api/project'),tasks=await get('/api/tasks'),documents=(await get('/api/documents')).filter(d=>d.kind==='optical-flow'),rows=[]
 assert(documents.length>0,'No saved flow documents')
 for(const info of documents){const saved=await get('/api/documents/'+info.id),d=await restoreFlow(saved.payload),serialized=await serializeFlow(d)
  assert.deepEqual(serialized,validateStoredFlow(saved.payload))
  if(d.split&&d.flow)assert(d.flow.inputs.every((f,i)=>f===d.split.outputs[i]))
  for(const r of [d.zip,d.sprite])if(r)assert(r.inputs.every((f,i)=>f===d.flow.outputs[i]))
  rows.push({id:info.id,revision:saved.revision,inputMode:d.inputMode,sourceFiles:d.files.length,splitFrames:d.split?.outputs.length??0,resultFrames:d.flow?.outputs.length??0,normalizationTasks:d.normalizations.length,taskIds:[...d.normalizations,d.split,d.flow,d.zip,d.sprite].filter(Boolean).map(r=>r.taskId),referenceIdentityPreserved:true})
 }
 const after=await get('/api/project'),afterTasks=await get('/api/tasks'),signature=p=>p.assets.map(a=>[a.id,a.current_version])
 assert.deepEqual(signature(after),signature(before));assert.deepEqual(afterTasks.map(t=>[t.id,t.state,t.results]),tasks.map(t=>[t.id,t.state,t.results]))
 const record={projectId:before.project.id,documents:rows,tasks:tasks.length,assets:before.assets.length,reads,metadataPosts,writes:0,unchanged:true}
 await writeFile(args[outputIndex+1],JSON.stringify(record,null,2)+'\n');process.stdout.write(JSON.stringify({documents:rows.length,tasks:tasks.length,writes:0,unchanged:true})+'\n')
}finally{globalThis.fetch=native}
