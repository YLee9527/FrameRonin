import {checkFineEditorBudget,fineEditorDimensions} from '../lib/fineEditorPixels'
import {importManagedInputs} from './managedTasks'
import {imageToolMetadata} from './imageToolDocument'

export async function prepareFineInput(file:File,retainedBytes=0){
  if(!file.name||file.name.length>255||/[\\/]/.test(file.name)||[...file.name].some(character=>character.charCodeAt(0)<32))throw new Error('FINE_EDITOR_SOURCE_NAME')
  if(!/\.(png|jpe?g|webp)$/i.test(file.name))throw new Error('FINE_EDITOR_SOURCE_TYPE')
  if(file.size<=0||file.size>20*1024**2)throw new Error('FINE_EDITOR_SOURCE_SIZE: select an image up to 20 MiB')
  const result=await importManagedInputs([file]),version=result.versions[0],metadata=version.metadata
  if(metadata.kind!=='image'||metadata.containerFormat&&!['PNG','JPEG','WEBP'].includes(metadata.containerFormat)||metadata.bytes!==file.size||!Number.isSafeInteger(metadata.width)||!Number.isSafeInteger(metadata.height))throw new Error('FINE_EDITOR_SOURCE_TYPE')
  const size=fineEditorDimensions(metadata)
  checkFineEditorBudget(size.width!,size.height!,file.size,result.memoryBudgetBytes,retainedBytes)
  imageToolMetadata.set(file,version)
  return {version,memoryBudgetBytes:result.memoryBudgetBytes}
}
