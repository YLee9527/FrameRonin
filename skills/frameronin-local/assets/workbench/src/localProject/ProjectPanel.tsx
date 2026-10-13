import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Drawer, List, Space, Tag, Typography, Upload } from 'antd'
import { FolderOpenOutlined, UploadOutlined } from '@ant-design/icons'
import { useLanguage } from '../i18n/context'
import { jsonPost, localJson } from './api'

type Asset = { id: string; name: string; current_version: string; metadata?: { kind: string; width?: number; height?: number; thumbnailDataUrl?: string } }
type Task = { id: string; state: string; progress: number; results: string[]; aiState?: string; error?: { message: string } }

export default function ProjectPanel() {
  const { lang } = useLanguage()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [assets, setAssets] = useState<Asset[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [error, setError] = useState('')
  const [canceling, setCanceling] = useState<Set<string>>(() => new Set())
  const text = lang === 'zh' ? { project: '项目素材与任务', import: '导入素材', tasks: '后台任务', cancel: '取消', versions: '正式素材', error: '本地项目服务未连接' }
    : lang === 'ja' ? { project: '素材とタスク', import: '素材を読み込む', tasks: 'バックグラウンドタスク', cancel: 'キャンセル', versions: 'プロジェクト素材', error: 'ローカルサービスに接続できません' }
      : { project: 'Project assets and tasks', import: 'Import assets', tasks: 'Background tasks', cancel: 'Cancel', versions: 'Project assets', error: 'Local project service is disconnected' }
  const statusNames: Record<string, string> = lang === 'zh' ? { queued: '等待', running: '处理中', succeeded: '已完成', failed: '失败', canceled: '已取消' }
    : lang === 'ja' ? { queued: '待機中', running: '処理中', succeeded: '完了', failed: '失敗', canceled: 'キャンセル済み' }
      : { queued: 'Queued', running: 'Processing', succeeded: 'Completed', failed: 'Failed', canceled: 'Canceled' }
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
        <List dataSource={assets} renderItem={asset => <List.Item><Space>
          {asset.metadata?.kind === 'image' && asset.metadata.thumbnailDataUrl && <img src={asset.metadata.thumbnailDataUrl} loading="lazy" width={48} height={48}
            style={{ objectFit: 'contain', imageRendering: 'pixelated' }} alt={asset.name} draggable onDragStart={event => {
              event.dataTransfer.setData('application/x-frameronin-stash-url', `/api/versions/${asset.current_version}/content`)
              event.dataTransfer.effectAllowed = 'copy'
            }} />}
          <a href={`/api/versions/${asset.current_version}/content`} target="_blank" rel="noreferrer">{asset.name}</a>
          {asset.metadata?.width && <Typography.Text type="secondary">{asset.metadata.width}×{asset.metadata.height}</Typography.Text>}
        </Space></List.Item>} />
        <Typography.Title level={5}>{text.tasks}</Typography.Title>
        <List dataSource={tasks} renderItem={task => <List.Item><Space orientation="vertical">
          <Space><Tag>{statusNames[task.state] ?? task.state}</Tag><Typography.Text>{Math.round(task.progress * 100)}%</Typography.Text>
            {['queued', 'running'].includes(task.state) && <Button size="small" loading={canceling.has(task.id)} disabled={canceling.has(task.id)} onClick={async () => {
              setCanceling(items => new Set([...items, task.id]))
              try { await localJson(`/api/tasks/${task.id}/cancel`, jsonPost({})); await refresh() }
              catch (error) { setError(String(error)) }
              finally { setCanceling(items => { const next = new Set(items); next.delete(task.id); return next }) }
            }}>{text.cancel}</Button>}
          </Space>
          {task.error && <Typography.Text type="danger">{task.error.message}</Typography.Text>}
          {task.aiState && <Typography.Text type="secondary">{task.aiState === 'cancel_requested'
            ? (lang === 'zh' ? '结果已失效；请在 Codex 核对生成是否停止。' : lang === 'ja' ? '結果は無効です。Codex で生成の停止を確認してください。' : 'Result invalidated. Verify the original generation state in Codex.')
            : `ImageGen · ${task.aiState}`}</Typography.Text>}
          {task.results.map((version, index) => <a key={version} href={`/api/versions/${version}/content`} target="_blank" rel="noreferrer">{lang === 'zh' ? '查看结果' : lang === 'ja' ? '結果を表示' : 'View result'} {index + 1}</a>)}
        </Space></List.Item>} />
      </Space>
    </Drawer>
  </>
}
