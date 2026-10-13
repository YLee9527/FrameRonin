import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App, Button, Card, Checkbox, Slider, Space, Typography } from 'antd'
import {
  DEFAULT_PAINT_RGBA,
  EditorCanvas,
  ERASER_RGBA,
  RsepriteLayerPanel,
  RsepritePaletteBar,
  RsepriteTimeline,
  useRsepriteState,
} from './Rseprite'
import type { Rgba, RsepriteTool } from './Rseprite'
import { useLanguage } from '../i18n/context'
import DocumentSaveBar from '../localProject/DocumentSaveBar'
import { RsepritePersistence, type StoredRseprite } from '../localProject/rsepriteDocument'
import type { Document } from './Rseprite/types'

const DEFAULT_W = 64
const DEFAULT_H = 64

/**
 * RoninPro — Rseprite：Aseprite 类像素动画编辑
 * 第 1 步：文档；第 2～5 步：画布与历史；第 6 步：图层；第 7～9 步：多帧、复制帧、延时、洋葱皮
 */
export default function RoninProRseprite() {
  const { t, lang } = useLanguage()
  const { message } = App.useApp()
  const {
    doc,
    activeFrameIndex,
    activeLayerIndex,
    dispatch,
    resetDocument,
    setActiveLayer,
    setActiveFrame,
    addFrame,
    deleteFrame,
    setFrameDuration,
    setLayerVisible,
    setLayerLocked,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useRsepriteState(DEFAULT_W, DEFAULT_H)
  const persistence = useRef<RsepritePersistence | null>(null)
  persistence.current ??= new RsepritePersistence()

  const [tool, setTool] = useState<RsepriteTool>('pencil')
  const [onionSkinEnabled, setOnionSkinEnabled] = useState(false)
  const [onionSkinOpacityPct, setOnionSkinOpacityPct] = useState(35)
  const [primaryColor, setPrimaryColor] = useState<Rgba>(DEFAULT_PAINT_RGBA)
  const [secondaryColor, setSecondaryColor] = useState<Rgba>([
    255, 255, 255, 255,
  ])

  const paintRgba = useMemo((): Rgba => {
    if (tool === 'eraser') return ERASER_RGBA
    return primaryColor
  }, [tool, primaryColor])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return
      const el = e.target as HTMLElement | null
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el?.isContentEditable
      ) {
        return
      }
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === 'z') {
        if (e.shiftKey) {
          if (!canRedo) return
          e.preventDefault()
          redo()
        } else {
          if (!canUndo) return
          e.preventDefault()
          undo()
        }
        return
      }
      if (k === 'y') {
        if (!canRedo) return
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo, canUndo, canRedo])

  const onPaintPixels = useCallback(
    (
      pixels: Array<{ x: number; y: number }>,
      rgba: readonly [number, number, number, number],
    ) => {
      dispatch({
        type: 'PAINT_PIXELS',
        frameIndex: activeFrameIndex,
        celIndex: activeLayerIndex,
        pixels,
        rgba,
      })
    },
    [dispatch, activeFrameIndex, activeLayerIndex],
  )

  const activeLayerLocked = doc.layers[activeLayerIndex]?.locked ?? true

  return (
    <div style={{ width: '100%', maxWidth: 'min(calc(100vw - 48px), 1920px)' }}>
      <DocumentSaveBar<Document, StoredRseprite> kind="rseprite" snapshot={doc}
        serialize={document => persistence.current!.serialize(document)} restore={async value => {
          const document = await persistence.current!.deserialize(value)
          dispatch({ type: 'RESTORE_DOCUMENT', document })
          return document
        }} />
      <Typography.Paragraph style={{ marginBottom: 16, fontSize: 15 }}>
        {t('roninProRsepriteLead')}
      </Typography.Paragraph>

      <Card
        size="small"
        title={t('roninProRsepriteStep1Title')}
        style={{ marginBottom: 16 }}
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          {t('roninProRsepriteStep1Intro')}
        </Typography.Paragraph>
        <Typography.Paragraph style={{ marginBottom: 8 }}>
          <Typography.Text strong>{t('roninProRsepriteStep1DocSize')}：</Typography.Text>{' '}
          {doc.width} × {doc.height}
        </Typography.Paragraph>
        <Typography.Paragraph style={{ marginBottom: 8 }}>
          <Typography.Text strong>{t('roninProRsepriteStep1Frames')}：</Typography.Text>{' '}
          {doc.frames.length}
        </Typography.Paragraph>
        <Typography.Paragraph style={{ marginBottom: 8 }}>
          <Typography.Text strong>{t('roninProRsepriteStep1Layers')}：</Typography.Text>{' '}
          {doc.layers.length}
        </Typography.Paragraph>
        <Space wrap>
          <Button size="small" onClick={() => resetDocument(32, 32)}>
            {t('roninProRsepriteStep1Reset32')}
          </Button>
          <Button size="small" onClick={() => resetDocument(DEFAULT_W, DEFAULT_H)}>
            {t('roninProRsepriteStep1Reset64')}
          </Button>
        </Space>
      </Card>

      <Card
        size="small"
        title={t('roninProRsepriteStep2Title')}
        styles={{ body: { padding: 0 } }}
        style={{ marginBottom: 20 }}
      >
        <RsepritePaletteBar
          tool={tool}
          onToolChange={setTool}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          onPrimaryChange={setPrimaryColor}
          onSecondaryChange={setSecondaryColor}
        />
        <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
          <Space wrap align="center">
            <Button size="small" disabled={!canUndo} onClick={undo}>
              {t('roninProRsepriteUndo')}
            </Button>
            <Button size="small" disabled={!canRedo} onClick={redo}>
              {t('roninProRsepriteRedo')}
            </Button>
            <Checkbox
              checked={onionSkinEnabled}
              onChange={(e) => setOnionSkinEnabled(e.target.checked)}
              disabled={doc.frames.length < 2}
            >
              {t('roninProRsepriteOnionSkin')}
            </Checkbox>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('roninProRsepriteOnionOpacity')}
            </Typography.Text>
            <Slider
              min={5}
              max={100}
              value={onionSkinOpacityPct}
              onChange={setOnionSkinOpacityPct}
              disabled={!onionSkinEnabled || doc.frames.length < 2}
              style={{ width: 120, margin: 0 }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {onionSkinOpacityPct}%
            </Typography.Text>
          </Space>
        </div>
        <RsepriteTimeline
          doc={doc}
          activeFrameIndex={activeFrameIndex}
          onSelectFrame={setActiveFrame}
          onDuplicateFrame={() => {
            if (doc.frames.length >= 1000 || (doc.frames.length + 1) * doc.layers.length * doc.width * doc.height * 4 > 256 * 1024 ** 2) {
              message.error(lang === 'zh' ? '添加帧将超过文档内存或帧数限制，请缩小画布或减少帧。' : lang === 'ja' ? 'フレーム数またはメモリの上限です。サイズやフレーム数を減らしてください。' : 'Adding a frame would exceed the document budget. Reduce the canvas size or frame count.')
              return
            }
            addFrame()
          }}
          onDeleteFrame={deleteFrame}
          onFrameDurationChange={setFrameDuration}
        />
        <RsepriteLayerPanel
          layers={doc.layers}
          activeLayerIndex={activeLayerIndex}
          onSelectLayer={setActiveLayer}
          onToggleVisible={setLayerVisible}
          onToggleLocked={setLayerLocked}
        />
        <EditorCanvas
          doc={doc}
          frameIndex={activeFrameIndex}
          activeLayerIndex={activeLayerIndex}
          minHeight={280}
          onPaintPixels={activeLayerLocked ? undefined : onPaintPixels}
          paintRgba={paintRgba}
          onionSkinEnabled={onionSkinEnabled}
          onionSkinOpacity={onionSkinOpacityPct / 100}
        />
        <Typography.Paragraph
          type="secondary"
          style={{ margin: '10px 12px 4px', fontSize: 12 }}
        >
          {t('roninProRsepriteStep2Hint')}
        </Typography.Paragraph>
        <Typography.Paragraph
          type="secondary"
          style={{ margin: '0 12px 4px', fontSize: 12 }}
        >
          {t('roninProRsepriteStep3Hint')}
        </Typography.Paragraph>
        <Typography.Paragraph
          type="secondary"
          style={{ margin: '0 12px 4px', fontSize: 12 }}
        >
          {t('roninProRsepriteStep4Hint')}
        </Typography.Paragraph>
        <Typography.Paragraph
          type="secondary"
          style={{ margin: '0 12px 4px', fontSize: 12 }}
        >
          {t('roninProRsepriteStep5Hint')}
        </Typography.Paragraph>
        <Typography.Paragraph
          type="secondary"
          style={{ margin: '0 12px 4px', fontSize: 12 }}
        >
          {t('roninProRsepriteStep6Hint')}
        </Typography.Paragraph>
        <Typography.Paragraph
          type="secondary"
          style={{ margin: '0 12px 4px', fontSize: 12 }}
        >
          {t('roninProRsepriteStep7Hint')}
        </Typography.Paragraph>
        <Typography.Paragraph
          type="secondary"
          style={{ margin: '0 12px 4px', fontSize: 12 }}
        >
          {t('roninProRsepriteStep8Hint')}
        </Typography.Paragraph>
        <Typography.Paragraph
          type="secondary"
          style={{ margin: '0 12px 12px', fontSize: 12 }}
        >
          {t('roninProRsepriteStep9Hint')}
        </Typography.Paragraph>
      </Card>

    </div>
  )
}
