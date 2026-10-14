export function validateMapZipBudget(bytes:ArrayBuffer,budgetBytes:number):void{
  const view=new DataView(bytes)
  let end=-1
  for(let offset=bytes.byteLength-22;offset>=Math.max(0,bytes.byteLength-65557);offset--){
    if(view.getUint32(offset,true)===0x06054b50&&offset+22+view.getUint16(offset+20,true)===bytes.byteLength){end=offset;break}
  }
  if(end<0||view.getUint16(end+4,true)!==0||view.getUint16(end+6,true)!==0)throw new Error('MAP_ARCHIVE_ZIP_UNSUPPORTED')
  const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),start=view.getUint32(end+16,true)
  if(count===65535||count>2002||size>8*1024**2||start+size!==end||view.getUint16(end+8,true)!==count)throw new Error('MAP_ARCHIVE_ZIP_LIMIT')
  let offset=start,total=0
  for(let index=0;index<count;index++){
    if(offset+46>end||view.getUint32(offset,true)!==0x02014b50)throw new Error('MAP_ARCHIVE_ZIP_INVALID')
    const uncompressed=view.getUint32(offset+24,true)
    total+=uncompressed
    if(uncompressed===0xffffffff||total+bytes.byteLength*4>budgetBytes/4||view.getUint16(offset+8,true)&1)throw new Error('MAP_ARCHIVE_RESOURCE_LIMIT')
    const nameSize=view.getUint16(offset+28,true)
    const name=new TextDecoder().decode(new Uint8Array(bytes,offset+46,nameSize))
    if(name.startsWith('/')||name.includes('\\')||name.split('/').includes('..')||name.includes('\0'))throw new Error('MAP_ARCHIVE_PATH_INVALID')
    offset+=46+nameSize+view.getUint16(offset+30,true)+view.getUint16(offset+32,true)
  }
  if(offset!==end)throw new Error('MAP_ARCHIVE_ZIP_INVALID')
}
