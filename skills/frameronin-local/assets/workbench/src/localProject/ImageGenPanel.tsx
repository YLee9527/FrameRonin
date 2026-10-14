import { useEffect, useState } from 'react'
import { Alert, Button, Input, Modal, Select, Space, Typography } from 'antd'
import { useLanguage } from '../i18n/context'
import { jsonPost, localJson } from './api'
import { requestImageGen } from './imagegen'
import { GEM_PIXEL_POTPOURRI, GEM_PIXEL_POTPOURRI_HUB_SLOTS } from '../lib/gemPixelUrls'

type Asset = { id: string; name: string; current_version: string; metadata?: { kind: string } }

export default function ImageGenPanel() {
  const { lang, t } = useLanguage()
  const [template, setTemplate] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [assets, setAssets] = useState<Asset[]>([])
  const [references, setReferences] = useState<string[]>([])
  const [instruction, setInstruction] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const text = lang === 'zh' ? {
    title: 'ImageGen 素材创作', prompt: '描述角色、动作、尺寸、帧布局和背景要求', reference: '选择参考素材版本',
    create: '保存生成请求', note: '请求保存后，将下方指令发送给当前 Codex 会话，使用内置 ImageGen。', copy: '复制给 Codex',
  } : lang === 'ja' ? {
    title: 'ImageGen 素材制作', prompt: 'キャラクター、動作、サイズ、フレームと背景を説明', reference: '参照素材のバージョンを選択',
    create: '生成リクエストを保存', note: '保存後、以下の指示を現在の Codex 会話に送信してください。', copy: 'Codex への指示をコピー',
  } : {
    title: 'ImageGen asset creation', prompt: 'Describe the character, actions, size, frame layout and background', reference: 'Select reference versions',
    create: 'Save generation request', note: 'Send the saved instruction below to the current Codex conversation to use native ImageGen.', copy: 'Copy for Codex',
  }
  useEffect(() => {
    const requested = (event: Event) => {
      setTemplate((event as CustomEvent<string>).detail)
      setInstruction(''); setError(''); setPrompt(''); setReferences([])
      localJson<{ assets: Asset[] }>('/api/project').then(result => setAssets(result.assets)).catch(error => setError(String(error)))
    }
    const clicked = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest('a')
      const href = anchor?.getAttribute('href')
      if (href?.startsWith('#imagegen/')) { event.preventDefault(); requestImageGen(href) }
    }
    window.addEventListener('frameronin:imagegen', requested)
    document.addEventListener('click', clicked, true)
    return () => { window.removeEventListener('frameronin:imagegen', requested); document.removeEventListener('click', clicked, true) }
  }, [])
  return <Modal zIndex={2400} open={template !== null} title={text.title} onCancel={() => setTemplate(null)} footer={null} destroyOnHidden>
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Typography.Text>{[...GEM_PIXEL_POTPOURRI, ...GEM_PIXEL_POTPOURRI_HUB_SLOTS].find(item => item?.url === `#imagegen/${template}`)?.labelKey
        ? t([...GEM_PIXEL_POTPOURRI, ...GEM_PIXEL_POTPOURRI_HUB_SLOTS].find(item => item?.url === `#imagegen/${template}`)!.labelKey)
        : text.title}</Typography.Text>
      <Input.TextArea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={text.prompt} rows={5} maxLength={32000} />
      <Select mode="multiple" style={{ width: '100%' }} placeholder={text.reference} value={references} onChange={setReferences}
        maxCount={16} options={assets.filter(asset => asset.metadata?.kind === 'image').map(asset => ({ label: asset.name, value: asset.current_version }))} />
      {error && <Alert type="error" title={error} />}
      <Button type="primary" loading={busy} disabled={!prompt.trim()} onClick={async () => {
        setBusy(true); setError('')
        try {
          const request = await localJson<{ instruction: string }>('/api/ai/requests', jsonPost({ template, prompt, references }))
          setInstruction(request.instruction)
        } catch (error) { setError(String(error)) } finally { setBusy(false) }
      }}>{text.create}</Button>
      {instruction && <><Alert type="info" title={text.note} /><Typography.Paragraph copyable>{instruction}</Typography.Paragraph></>}
    </Space>
  </Modal>
}
