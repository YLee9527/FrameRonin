import { useMemo, useState } from 'react'
import { Button, InputNumber, message, Pagination, Space, Typography, Upload } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import { useLanguage } from '../i18n/context'
import { useManagedImageTool, useImageToolUrls } from '../localProject/useManagedImageTool'
import ManagedImageToolStatus from './ManagedImageToolStatus'
import StashableImage from './StashableImage'
import StashDropZone from './StashDropZone'

const { Dragger } = Upload
const { Text } = Typography
const IMAGE_ACCEPT = ['.png', '.jpg', '.jpeg', '.webp']
type Preview={raw:string|undefined;preview:string}
const checker={padding:12,borderRadius:8,border:'1px solid #9a8b78',background:'repeating-conic-gradient(#c9bfb0 0% 25%, #e4dbcf 0% 50%) 50% / 16px 16px'}

function FrameThumbnail({index,preview}:{index:number;preview:Preview|undefined}){
  return <div style={{position:'relative',display:'inline-block'}}>
    {preview?.preview&&<StashableImage src={preview.preview} stashSrc={preview.raw} alt={`${index+1}`}
      style={{width:56,height:56,objectFit:'contain',imageRendering:'pixelated',border:'1px solid rgba(0,0,0,.2)'}}/>}
    <span style={{position:'absolute',left:2,top:2,fontSize:10,fontWeight:'bold',color:'#fff',textShadow:'0 0 2px #000'}}>{index+1}</span>
  </div>
}
function DuplicateGroup({group,previews}:{group:number[];previews:Preview[]}){
  const {t}=useLanguage(),[page,setPage]=useState(1)
  const current=Math.min(page,Math.max(1,Math.ceil(group.length/12)))
  return <div style={checker}>
    <Typography.Paragraph ellipsis={{rows:2,expandable:true}}>{t('roninProDupFramesGroupLine',{list:group.map(index=>String(index+1)).join(', ')})}</Typography.Paragraph>
    <Space wrap>{group.slice((current-1)*12,current*12).map(index=><FrameThumbnail key={index} index={index} preview={previews[index]}/>)}</Space>
    {group.length>12&&<Pagination current={current} pageSize={12} total={group.length} onChange={setPage} showSizeChanger={false}/>}
  </div>
}

export default function RoninProDuplicateFrames(){
  const {t}=useLanguage()
  const [spriteFile,setSpriteFile]=useState<File|null>(null),[columns,setColumns]=useState(8),[rows,setRows]=useState(4)
  const [framePage,setFramePage]=useState(1),[groupPage,setGroupPage]=useState(1)
  const files=useMemo(()=>spriteFile?[spriteFile]:[],[spriteFile])
  const tool=useManagedImageTool(files,{columns,rows}),source=useImageToolUrls(files,tool.versions)[0]
  const resultFiles=useMemo(()=>tool.results.map(result=>result.file),[tool.results])
  const previews=useImageToolUrls(resultFiles,tool.results.map(result=>result.version))
  const groups=(tool.report.groups??[]) as number[][]
  const currentFramePage=Math.min(framePage,Math.max(1,Math.ceil(previews.length/24)))
  const currentGroupPage=Math.min(groupPage,Math.max(1,Math.ceil(groups.length/6)))
  const runAnalyze=async()=>{
    const result=await tool.run('image.findDuplicates')
    if(!result)return
    setFramePage(1);setGroupPage(1)
    const found=result.report.groups as number[][]
    if(found.length)message.success(t('roninProDupFramesFound',{groups:found.length,frames:result.results.length}))
    else message.info(t('roninProDupFramesNoDup'))
  }
  return <Space direction="vertical" size="large" style={{width:'100%'}}>
    <Text type="secondary">{t('roninProDupFramesHint')}</Text>
    <ManagedImageToolStatus tool={tool}/>
    <StashDropZone onStashDrop={setSpriteFile}>
      <Dragger accept={IMAGE_ACCEPT.join(',')} maxCount={1}
        fileList={spriteFile?[{uid:'1',name:spriteFile.name}] as UploadFile[]:[]}
        beforeUpload={file=>{setSpriteFile(file);return false}} onRemove={()=>setSpriteFile(null)}>
        <p className="ant-upload-text">{t('roninProDupFramesUploadHint')}</p>
      </Dragger>
    </StashDropZone>
    {spriteFile&&<>
      <Space wrap>
        <label><Text type="secondary">{t('roninProDupFramesCols')}: </Text><InputNumber aria-label={t('roninProDupFramesCols')} min={1} max={64} value={columns} onChange={value=>setColumns(value??8)}/></label>
        <label><Text type="secondary">{t('roninProDupFramesRows')}: </Text><InputNumber aria-label={t('roninProDupFramesRows')} min={1} max={64} value={rows} onChange={value=>setRows(value??4)}/></label>
        <Button type="primary" icon={<SearchOutlined/>} loading={!!tool.busy} disabled={!tool.ready||!!tool.busy} onClick={runAnalyze}>{t('roninProDupFramesRun')}</Button>
      </Space>
      <Text type="secondary">{t('roninProDupFramesLogicHint')}</Text>
      {source?.preview&&<div style={{...checker,alignSelf:'flex-start'}}><StashableImage src={source.preview} stashSrc={source.raw} alt={spriteFile.name}
        style={{maxWidth:480,maxHeight:280,imageRendering:'pixelated',display:'block'}}/></div>}
    </>}
    {previews.length>0&&<>
      <Text strong>{t('roninProDupFramesAllFrames')}</Text>
      <div style={{...checker,display:'flex',flexWrap:'wrap',gap:8}}>
        {previews.slice((currentFramePage-1)*24,currentFramePage*24).map((preview,index)=><FrameThumbnail key={index} index={(currentFramePage-1)*24+index} preview={preview}/>)}
      </div>
      {previews.length>24&&<Pagination current={currentFramePage} pageSize={24} total={previews.length} onChange={setFramePage} showSizeChanger={false}/>}
    </>}
    {groups.length>0&&<>
      <Text strong>{t('roninProDupFramesResultTitle')}</Text>
      {groups.slice((currentGroupPage-1)*6,currentGroupPage*6).map((group,index)=><DuplicateGroup key={`${tool.results[0]?.version.id}-${(currentGroupPage-1)*6+index}`} group={group} previews={previews}/>)}
      {groups.length>6&&<Pagination current={currentGroupPage} pageSize={6} total={groups.length} onChange={setGroupPage} showSizeChanger={false}/>}
    </>}
  </Space>
}
