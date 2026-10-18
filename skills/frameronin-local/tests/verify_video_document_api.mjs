/** Read existing formal video documents through current production serializers.
 * Refuse every HTTP mutation: restoring/saving the same references must need no
 * imports, processing tasks or server-side changes. The UI test saves them first.
 */
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {restoreVideo,serializeVideo} from '../.runtime/js/algorithms.mjs'

const args=process.argv.slice(2),baseIndex=args.indexOf('--base'),outputIndex=args.indexOf('--output')
assert(baseIndex>=0&&outputIndex>=0,'Pass --base http://127.0.0.1:<owned-port> --output <json>')
const base=new URL(args[baseIndex+1]);assert(base.protocol==='http:'&&['127.0.0.1','localhost'].includes(base.hostname)&&Number(base.port)>=1024&&Number(base.port)<=65535&&base.pathname==='/'&&!base.username&&!base.password&&!base.search&&!base.hash,'Owned loopback server required')
const native=globalThis.fetch;let requests=0
globalThis.fetch=(input,init={})=>{
 assert(typeof input==='string'&&input.startsWith('/api/'),'Unexpected request URL')
 assert(!init.method||init.method.toUpperCase()==='GET','Verification must not create tasks, assets or documents')
 requests++;return native(new URL(input,base),init)
}
const get=async path=>{const response=await fetch(path);assert(response.ok);return response.json()}
try{
 const before=await get('/api/project'),beforeTasks=await get('/api/tasks'),documents=(await get('/api/documents')).filter(d=>d.kind==='video');assert(documents.length>0,'No saved video documents')
 const rows=[]
 for(const info of documents){
  const saved=await get(`/api/documents/${info.id}`),draft=await restoreVideo(saved.payload),serialized=await serializeVideo(draft)
  assert.deepEqual(serialized,saved.payload)
  if(draft.capture)assert.equal(draft.capture.inputs[0],draft.source)
  if(draft.processed)assert.equal(draft.processed.inputs[0],draft.capture.data)
  if(draft.styledSheet)assert.equal(draft.styledSheet.inputs[0],draft.processed.data)
  rows.push({id:info.id,revision:saved.revision,sourceVersion:serialized.source?.versionId,taskId:serialized.processed?.taskId,referenceIdentityPreserved:true})
 }
 const after=await get('/api/project'),afterTasks=await get('/api/tasks'),signature=p=>p.assets.map(a=>[a.id,a.current_version])
 assert.deepEqual(signature(after),signature(before));assert.deepEqual(afterTasks.map(t=>[t.id,t.state,t.results]),beforeTasks.map(t=>[t.id,t.state,t.results]))
 const record={projectId:before.project.id,documents:rows,tasks:beforeTasks.length,assets:before.assets.length,requests,writes:0,unchanged:true}
 await writeFile(args[outputIndex+1],JSON.stringify(record,null,2)+'\n');process.stdout.write(JSON.stringify({documents:rows.length,tasks:beforeTasks.length,writes:0,unchanged:true})+'\n')
}finally{globalThis.fetch=native}
