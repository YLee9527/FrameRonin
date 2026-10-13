import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Drawer, List, Space, Tag, Typography, Upload } from 'antd'
import { FolderOpenOutlined, UploadOutlined } from '@ant-design/icons'
import { useLanguage } from '../i18n/context'
import { jsonPost, localJson } from './api'

type Asset = { id: string; name: string; current_version: string }
type Task = { id: string; state: string; progress: number; results: string[]; error?: { message: string } }

export default function ProjectPanel() {
  const { lang } = useLanguage()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [assets, setAssets] = useState<Asset[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [error, setError] = useState('')
  const text = lang === 'zh' ? { project: '项目素材与任务', import: '导入素材', tasks: '后台任务', cancel: '取消', versions: '正式素材', error: '本地项目服务未连接' }
    : lang === 'ja' ? { project: '素材とタスク', import: '素材を読み込む', tasks: 'バックグラウンドタスク', cancel: 'キャンセル', versions: 'プロジェクト素材', error: 'ローカルサービスに接続できません' }
      : { project: 'Project assets and tasks', import: 'Import assets', tasks: 'Background tasks', cancel: 'Cancel', versions: 'Project assets', error: 'Local project service is disconnected' }
  const refresh = useCallback(async () => {
    try {
      const [project, jobs] = await Promise.all([localJson<{ project: { name: string }; assets: Asset[] }>('/api/project'), localJson<Task[]>('/api/tasks')])
      setName(project.project.name); setAssets(project.assets); setTasks(jobs); setError('')
    } catch (error) { setError(String(error)) }
  }, [])
  useEffect(() => {
    if (!open) return
    void refresh()
    const interval = setInterval(refresh, 2000)
    return () => clearInterval(interval)
  }, [open, refresh])
  return <>
    <Button icon={<FolderOpenOutlined />} style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 100 }} onClick={() => setOpen(true)}>{text.project}</Button>
    <Drawer width={480} title={`${text.project}${name ? ` · ${name}` : ''}`} open={open} onClose={() => setOpen(false)}>
      <Space orientation="vertical" style={{ width: '100%' }}>
        {error && <Alert type="error" title={text.error} description={error} />}
        <Upload multiple showUploadList={false} beforeUpload={async file => {
          const form = new FormData(); form.append('file', file)
          try { await localJson('/api/assets', { method: 'POST', body: form }); await refresh() }
          catch (error) { setError(String(error)) }
          return false
        }}><Button icon={<UploadOutlined />}>{text.import}</Button></Upload>
        <Typography.Title level={5}>{text.versions}</Typography.Title>
        <List dataSource={assets} renderItem={asset => <List.Item><a href={`/api/versions/${asset.current_version}/content`} target="_blank" rel="noreferrer">{asset.name}</a></List.Item>} />
        <Typography.Title level={5}>{text.tasks}</Typography.Title>
        <List dataSource={tasks} renderItem={task => <List.Item><Space orientation="vertical">
          <Space><Tag>{task.state}</Tag><Typography.Text>{Math.round(task.progress * 100)}%</Typography.Text>
            {['queued', 'running'].includes(task.state) && <Button size="small" onClick={async () => {
              try { await localJson(`/api/tasks/${task.id}/cancel`, jsonPost({})); await refresh() }
              catch (error) { setError(String(error)) }
            }}>{text.cancel}</Button>}
          </Space>
          {task.error && <Typography.Text type="danger">{task.error.message}</Typography.Text>}
          {task.results.map(version => <a key={version} href={`/api/versions/${version}/content`} target="_blank" rel="noreferrer">{version.slice(0, 8)}</a>)}
        </Space></List.Item>} />
      </Space>
    </Drawer>
  </>
}
