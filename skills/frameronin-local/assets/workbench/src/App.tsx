import ProjectPanel from './localProject/ProjectPanel'
import ImageGenPanel from './localProject/ImageGenPanel'
import { navigateWithSave } from './localProject/navigationGuard'
import { lazy, Suspense, useCallback, useState, useEffect,useRef } from 'react'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { App as AntdApp, Button, Card, ConfigProvider, Layout, Spin, Steps,message } from 'antd'
import {managedFile} from './localProject/managedTasks'
import {prepareFineInput} from './localProject/fineEditInput'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'
import jaJP from 'antd/locale/ja_JP'
import type { ThemeConfig } from 'antd'
import { LocalWorkspaceProvider } from './localWorkspace/context'
import { ImageStashProvider } from './stash/context'
import { useLanguage } from './i18n/context'
import ImageStashPanel from './components/ImageStashPanel'
import GifFrameConverter from './components/GifFrameConverter'
import ImageExpandShrink from './components/ImageExpandShrink'
import ImagePixelate from './components/ImagePixelate'
import ImageResizeStroke from './components/ImageResizeStroke'
import ImageModuleEntry, { type ImageSubMode } from './components/ImageResizeStroke/ImageModuleEntry'
import ImageFineProcess from './components/ImageResizeStroke/ImageFineProcess'
import ModeSelector, { type AppMode } from './components/ModeSelector'
import SpriteSheetTool from './components/SpriteSheetTool'
import SpriteSheetAdjust from './components/SpriteSheetAdjust'
import ImageGeminiWatermark from './components/ImageGeminiWatermark'
import NanobananaFullChar from './components/NanobananaFullChar'
import SeedanceWatermarkRemover from './components/SeedanceWatermarkRemover'
import AssetsAndSourceShare from './components/AssetsAndSourceShare'
import ControlTest from './components/ControlTest'
import RoninPro from './components/RoninPro'
import AiPixelAnimalsHub from './components/AiPixelAnimalsHub'
import GemPixelPotpourriHub from './components/GemPixelPotpourriHub'
import InfiniteMapPlaceholder from './components/InfiniteMapPlaceholder'
import MapStitch from './components/MapStitch'

const ImageMatte = lazy(() => import('./components/ImageMatte'))
import ParamsStep from './components/ParamsStep'
import UploadStep from './components/UploadStep'
import type { JobParams } from './api'
import type { Lang } from './i18n/locales'
import './App.css'

const { Header, Content, Footer } = Layout

const antdLocales: Record<Lang, typeof zhCN> = { zh: zhCN, en: enUS, ja: jaJP }



export type Step = 'upload' | 'params'

const STEP_KEYS: Step[] = ['upload', 'params']

function AppHeaderRight({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <>
      <div className="app-header-lang">
        {(['zh', 'en', 'ja'] as const).map((l) => (
          <button
            key={l}
            type="button"
            className={`app-header-lang-btn ${lang === l ? 'active' : ''}`}
            onClick={() => setLang(l)}
          >
            {l === 'zh' ? '中' : l === 'en' ? 'EN' : '日'}
          </button>
        ))}
      </div>

    </>
  )
}

function App() {
  const { lang, setLang, t } = useLanguage()
  const [mode, updateMode] = useState<AppMode>(null)
  const setMode = useCallback((value: AppMode) => { void navigateWithSave(() => updateMode(value)) }, [])
  /** 首页快捷键：R/T/N → RoninPro 子模块、S → Sprite Sheet 调整等 */
  const [roninProDeepLink, setRoninProDeepLink] = useState<string | null>(null)
  const consumeRoninProDeepLink = useCallback(() => setRoninProDeepLink(null), [])
  const [imageSubMode, setImageSubMode] = useState<ImageSubMode | 'select'>('select')
  /** 常规处理 → 精细处理 图稿传递 */
  const [imageHandoffToFine, setImageHandoffToFine] = useState<File | null>(null)
  const handoffRunning=useRef(false),currentView=useRef('')
  currentView.current=`${mode??'home'}:${mode==='image'?imageSubMode:''}`
  const sendToFineProcess=async(blob:Blob,suggestedFilename:string)=>{
    if(handoffRunning.current)return false
    handoffRunning.current=true
    const before=currentView.current
    try{
      const proposed=/\.(png|jpe?g|webp)$/i.test(suggestedFilename)?suggestedFilename:`${suggestedFilename}.png`
      const dot=proposed.lastIndexOf('.'),extension=proposed.slice(dot),name=proposed.slice(0,dot).slice(0,255-extension.length)+extension
      const file=managedFile(blob,name,blob.type||'image/png')
      await prepareFineInput(file)
      if(currentView.current!==before)return false
      return await navigateWithSave(()=>{setImageHandoffToFine(file);setImageSubMode('fine');updateMode('image')})
    }catch(error){message.error(String(error));return false}
    finally{handoffRunning.current=false}
  }

  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [params, setParams] = useState<JobParams>({
    fps: 12,
    frame_range: { start_sec: 0, end_sec: 5 },
    max_frames: 300,
    target_size: { w: 256, h: 256 },
    transparent: true,
    padding: 0,
    spacing: 0,
    layout_mode: 'fixed_columns',
    columns: 4,
    matte_strength: 0.6,
    crop_mode: 'tight_bbox',
  })
  const currentStep = STEP_KEYS.indexOf(step)

  /** 任意大功能内按 B 返回首页（输入框内不触发，避免误触） */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return
      if (mode === null) return
      if (e.code !== 'KeyB') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement
      const tag = el?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      if (el instanceof HTMLElement && el.isContentEditable) return
      e.preventDefault()
      void navigateWithSave(()=>{
        if(mode==='video'){setStep('upload');setFile(null)}
        if(mode==='image')setImageSubMode('select')
        setRoninProDeepLink(null);updateMode(null)
      })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode,setMode])

  /** 首页按 C 进入 gif、帧排序、合并模块 */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (mode !== null) return
      if (e.code !== 'KeyC') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement
      const tag = el?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      if (el instanceof HTMLElement && el.isContentEditable) return
      e.preventDefault()
      setMode('gif')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode,setMode])

  /** 首页按 R 进入 RoninPro → 自定义缩放 */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (mode !== null) return
      if (e.code !== 'KeyR') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement
      const tag = el?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      if (el instanceof HTMLElement && el.isContentEditable) return
      e.preventDefault()
      setRoninProDeepLink('customScale')
      setMode('roninPro')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode,setMode])

  /** 首页按 T 进入 RoninPro → 自定义流程蓝图 */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (mode !== null) return
      if (e.code !== 'KeyT') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement
      const tag = el?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      if (el instanceof HTMLElement && el.isContentEditable) return
      e.preventDefault()
      setRoninProDeepLink('customWorkflow')
      setMode('roninPro')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode,setMode])

  /** 首页按 N 进入 RoninPro → 单图调整 Pro */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (mode !== null) return
      if (e.code !== 'KeyN') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement
      const tag = el?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      if (el instanceof HTMLElement && el.isContentEditable) return
      e.preventDefault()
      setRoninProDeepLink('sheetPro')
      setMode('roninPro')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode,setMode])

  /** 首页按 G 进入 Gemini 水印去除 */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (mode !== null) return
      if (e.code !== 'KeyG') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement
      const tag = el?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      if (el instanceof HTMLElement && el.isContentEditable) return
      e.preventDefault()
      setMode('geminiwatermark')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode,setMode])

  /** 首页按 V 进入一键/精细像素图处理 */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (mode !== null) return
      if (e.code !== 'KeyV') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement
      const tag = el?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      if (el instanceof HTMLElement && el.isContentEditable) return
      e.preventDefault()
      setImageSubMode('select')
      setMode('image')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode,setMode])

  /** 首页按 S 进入 Sprite Sheet 调整 */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (mode !== null) return
      if (e.code !== 'KeyS') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement
      const tag = el?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      if (el instanceof HTMLElement && el.isContentEditable) return
      e.preventDefault()
      setMode('spriteadjust')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode,setMode])

  const wastelandTheme: ThemeConfig = {
    token: {
      colorPrimary: '#b55233',
      colorPrimaryHover: '#c45c3e',
      colorPrimaryActive: '#9a4529',
      colorBorder: '#9a8b78',
      colorBorderSecondary: '#b8a898',
      colorBgContainer: '#ede6dc',
      colorBgLayout: '#c9bfb0',
      colorText: '#3d3428',
      colorTextSecondary: '#6b5d4d',
    },
    components: {
      Card: {
        headerBg: 'transparent',
      },
      Steps: {
        colorPrimary: '#b55233',
        colorText: '#3d3428',
        colorTextDescription: '#6b5d4d',
      },
    },
  }

  return (
    <ConfigProvider locale={antdLocales[lang]} theme={wastelandTheme}>
      <LocalWorkspaceProvider>
      <ImageStashProvider>
      <AntdApp>
      <ImageStashPanel />
      <ImageGenPanel />
      <ProjectPanel />
      <Layout className="app-layout">
        <Header className="app-header">
          <div className="app-header-bg" aria-hidden="true" />
          <div className="app-header-content">
            <div className="app-header-left">
              <img src={`${import.meta.env.BASE_URL}logopix.png`} alt="FrameRonin" className="app-header-logo" />
              <div className="app-header-text">
                <div className="app-header-row">
                  <h1 className="app-header-brand">FrameRonin</h1>
                  <span className="app-header-ver">V3</span>
                </div>
                <p className="app-header-subtitle">{t('subtitle')}</p>
              </div>
            </div>
            <div className="app-header-right">
              <AppHeaderRight lang={lang} setLang={setLang} />
            </div>
          </div>
        </Header>
        <Content
          className="app-content"
          style={
            mode === 'spriteadjust'
              ? { maxWidth: 1120, width: '100%' }
              : mode === 'mapStitch'
                ? {
                    width: '100%',
                    maxWidth: 'none',
                    margin: 0,
                    padding: 0,
                  }
              : mode === 'infiniteMap'
                ? {
                    width: '80%',
                    maxWidth: 'none',
                    marginLeft: 'auto',
                    marginRight: 'auto',
                    paddingTop: 12,
                    paddingBottom: 12,
                    paddingLeft: 16,
                    paddingRight: 16,
                    boxSizing: 'border-box',
                  }
                : undefined
          }
        >
          {mode === null ? (
            <Card>
              <ModeSelector
                onSelect={(m) => {
                  setMode(m)
                  if (m === 'image') {
                    setImageSubMode('select')
                    setImageHandoffToFine(null)
                  }
                  if (m === 'roninPro') setRoninProDeepLink(null)
                }}
              />
            </Card>
          ) : mode === 'image' ? (
            <Card>
              <div style={{ marginBottom: 16 }}>
                <Button
                  type="text"
                  icon={<ArrowLeftOutlined />}
                  onClick={() => {void navigateWithSave(()=>{if(imageSubMode==='select')updateMode(null);else setImageSubMode('select')})}}
                >
                  {imageSubMode === 'select' ? t('backToHome') : t('back')}
                </Button>
              </div>
              {imageSubMode === 'select' ? (
                <ImageModuleEntry onSelect={setImageSubMode} />
              ) : imageSubMode === 'normal' ? (
                <ImageResizeStroke onSendToFineProcess={sendToFineProcess}/>
              ) : (
                <ImageFineProcess
                  handoffFile={imageHandoffToFine}
                  onHandoffConsumed={() => setImageHandoffToFine(null)}
                />
              )}
            </Card>
          ) : mode === 'gif' ? (
            <Card>
              <div style={{ marginBottom: 16 }}>
                <Button
                  type="text"
                  icon={<ArrowLeftOutlined />}
                  onClick={() => setMode(null)}
                >
                  {t('backToHome')}
                </Button>
              </div>
              <GifFrameConverter />
            </Card>
          ) : mode === 'spritesheet' ? (
            <Card>
              <div style={{ marginBottom: 16 }}>
                <Button
                  type="text"
                  icon={<ArrowLeftOutlined />}
                  onClick={() => setMode(null)}
                >
                  {t('backToHome')}
                </Button>
              </div>
              <SpriteSheetTool />
            </Card>
          ) : mode === 'pixelate' ? (
            <Card>
              <div style={{ marginBottom: 16 }}>
                <Button
                  type="text"
                  icon={<ArrowLeftOutlined />}
                  onClick={() => setMode(null)}
                >
                  {t('backToHome')}
                </Button>
              </div>
              <ImagePixelate />
            </Card>
          ) : mode === 'expandshrink' ? (
            <Card>
              <div style={{ marginBottom: 16 }}>
                <Button
                  type="text"
                  icon={<ArrowLeftOutlined />}
                  onClick={() => setMode(null)}
                >
                  {t('backToHome')}
                </Button>
              </div>
              <ImageExpandShrink />
            </Card>
          ) : mode === 'matte' ? (
            <Card>
              <div style={{ marginBottom: 16 }}>
                <Button
                  type="text"
                  icon={<ArrowLeftOutlined />}
                  onClick={() => setMode(null)}
                >
                  {t('backToHome')}
                </Button>
              </div>
              <Suspense fallback={<div style={{ padding: 48, textAlign: 'center' }}><Spin size="large" /></div>}>
                <ImageMatte />
              </Suspense>
            </Card>
          ) : mode === 'spriteadjust' ? (
            <Card>
              <div style={{ marginBottom: 16 }}>
                <Button
                  type="text"
                  icon={<ArrowLeftOutlined />}
                  onClick={() => setMode(null)}
                >
                  {t('backToHome')}
                </Button>
              </div>
              <SpriteSheetAdjust />
            </Card>
          ) : mode === 'geminiwatermark' ? (
            <Card>
              <div style={{ marginBottom: 16 }}>
                <Button
                  type="text"
                  icon={<ArrowLeftOutlined />}
                  onClick={() => setMode(null)}
                >
                  {t('backToHome')}
                </Button>
              </div>
              <ImageGeminiWatermark />
            </Card>
          ) : mode === 'nanobananaFullChar' ? (
            <Card>
              <div style={{ marginBottom: 16 }}>
                <Button
                  type="text"
                  icon={<ArrowLeftOutlined />}
                  onClick={() => setMode(null)}
                >
                  {t('backToHome')}
                </Button>
              </div>
              <NanobananaFullChar />
            </Card>
          ) : mode === 'seedanceWatermark' ? (
            <Card>
              <div style={{ marginBottom: 16 }}>
                <Button
                  type="text"
                  icon={<ArrowLeftOutlined />}
                  onClick={() => setMode(null)}
                >
                  {t('backToHome')}
                </Button>
              </div>
              <SeedanceWatermarkRemover />
            </Card>
          ) : mode === 'assetsAndSource' ? (
            <Card>
              <div style={{ marginBottom: 16 }}>
                <Button
                  type="text"
                  icon={<ArrowLeftOutlined />}
                  onClick={() => setMode(null)}
                >
                  {t('backToHome')}
                </Button>
              </div>
              <AssetsAndSourceShare />
            </Card>
          ) : mode === 'controlTest' ? (
            <ControlTest key="topdown" onBack={() => setMode(null)} variant="topdown" />
          ) : mode === 'controlTestArcade' ? (
            <ControlTest key="arcade" onBack={() => setMode(null)} variant="arcade" />
          ) : mode === 'roninPro' ? (
            <Card>
              <RoninPro
                onBack={() => { setRoninProDeepLink(null); setMode(null) }}
                deepLinkFeature={roninProDeepLink}
                onDeepLinkConsumed={consumeRoninProDeepLink}
                onSendToFineProcess={sendToFineProcess}
              />
            </Card>
          ) : mode === 'mapStitch' ? (
            <MapStitch onBack={() => setMode(null)} />
          ) : mode === 'infiniteMap' ? (
            <InfiniteMapPlaceholder onBack={() => setMode(null)} />
          ) : mode === 'aiPixelAnimals' ? (
            <AiPixelAnimalsHub onBack={() => setMode(null)} />
          ) : mode === 'gemPixelPotpourri' ? (
            <GemPixelPotpourriHub onBack={() => setMode(null)} />
          ) : (
            <>
              <Steps
                current={currentStep}
                onChange={(idx) => {void navigateWithSave(()=>setStep(STEP_KEYS[idx]))}}
                items={[
                  { title: t('stepUpload') },
                  { title: t('stepParams') },
                ]}
                style={{ marginBottom: 32 }}
              />
              <Card>
                <div style={{ marginBottom: 16 }}>
                  <Button
                    type="text"
                    icon={<ArrowLeftOutlined />}
                    onClick={() => {void navigateWithSave(()=>{updateMode(null);setStep('upload');setFile(null)})}}
                  >
                    {t('backToHome')}
                  </Button>
                </div>
                {step === 'upload' && (
                  <UploadStep
                    file={file}
                    onFileChange={setFile}
                    onNext={() => setStep('params')}
                  />
                )}
                {step === 'params' && (
                  <ParamsStep
                    file={file}
                    params={params}
                    onParamsChange={setParams}
                    onFileChange={setFile}
                  />
                )}
              </Card>
            </>
          )}
        </Content>
        <Footer className="app-footer">
          <div className="app-footer-inner">
            <div className="app-footer-copyright">
              <span>© {new Date().getFullYear()} FrameRonin</span>
              <span className="app-footer-sep">·</span>
              <span className="app-footer-powered">
                {t('poweredBy')}{' '}
                <img src={`${import.meta.env.BASE_URL}ronincat.png`} alt="RoninCat" className="app-footer-avatar" />
                <strong>RoninCat</strong>
              </span>
              <span className="app-footer-sep">·</span>
              <a href="https://github.com/systemchester/FrameRonin" target="_blank" rel="noopener noreferrer" className="app-footer-source">
                {t('footerSourceCode')}
              </a>
              <span className="app-footer-sep">·</span>
            </div>
          </div>
        </Footer>
      </Layout>
      </AntdApp>
      </ImageStashProvider>
      </LocalWorkspaceProvider>
    </ConfigProvider>
  )
}

export default App
