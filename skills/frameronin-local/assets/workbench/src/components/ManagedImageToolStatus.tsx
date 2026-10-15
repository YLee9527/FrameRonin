import { Button, Progress, Space, Typography } from 'antd'
import type { useManagedImageTool } from '../localProject/useManagedImageTool'

export default function ManagedImageToolStatus({tool}:{tool:ReturnType<typeof useManagedImageTool>}){
  return <Space direction="vertical" style={{width:'100%'}}>
    {tool.preparing&&<Typography.Text role="status">{tool.text.preparing}</Typography.Text>}
    {tool.busy&&<Space style={{width:'100%'}}>
      <Progress percent={Math.round(tool.progress*100)} style={{width:180}} size="small"/>
      <Button onClick={tool.cancel} loading={tool.canceling}>{tool.canceling?tool.text.canceling:tool.text.cancel}</Button>
    </Space>}
    <Typography.Text type="secondary">{tool.text.thumbnail}</Typography.Text>
  </Space>
}
