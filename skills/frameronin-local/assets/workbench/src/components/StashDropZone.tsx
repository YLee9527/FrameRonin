import { useCallback } from 'react'
import {stashTransferName} from '../stash/transfer'

const STASH_DRAG_TYPE = 'application/x-frameronin-stash-url'

interface StashDropZoneProps {
  children: React.ReactNode
  onStashDrop: (file: File) => void
  maxSizeMB?: number
  onSizeError?: () => void
  maxFiles?:number
  onCountError?:()=>void
  disabled?:boolean
}

/** 包装上传区域，使暂存中的图片拖入时能转换为 File 并触发 onStashDrop */
export default function StashDropZone({
  children,
  onStashDrop,
  maxSizeMB = 20,
  onSizeError,
  maxFiles=Infinity,
  onCountError,
  disabled=false,
}: StashDropZoneProps) {
  /**
   * 必须在捕获阶段处理：若用冒泡 onDrop，内层 antd Dragger 会先 beforeUpload 加一份文件，
   * 再冒泡到本层又 onStashDrop，导致同一张图出现两次。
   */
  const handleDropCapture = useCallback(
    async (e: React.DragEvent) => {
      if(disabled){e.preventDefault();e.stopPropagation();return}
      const url = e.dataTransfer.getData(STASH_DRAG_TYPE)
      if (url) {
        const name=e.dataTransfer.getData('application/x-frameronin-stash-name')
        e.preventDefault()
        e.stopPropagation()
        if(maxFiles<1){onCountError?.();return}
        try {
          const res = await fetch(url)
          const blob = await res.blob()
          if (maxSizeMB > 0 && blob.size > maxSizeMB * 1024 * 1024) {
            onSizeError?.()
            return
          }
          const file = new File([blob], stashTransferName(name,blob.type), { type: blob.type })
          onStashDrop(file)
        } catch {
          /* ignore */
        }
        return
      }
      const files = e.dataTransfer.files
      if (files?.length) {
        e.preventDefault()
        e.stopPropagation()
        if(Array.from(files).filter(f=>f.type.startsWith('image/')).length>maxFiles){onCountError?.();return}
        for (let i = 0; i < files.length; i++) {
          const f = files[i]
          if (!f || !f.type.startsWith('image/')) continue
          if (maxSizeMB > 0 && f.size > maxSizeMB * 1024 * 1024) {
            onSizeError?.()
            continue
          }
          onStashDrop(f)
        }
      }
    },
    [onStashDrop, maxSizeMB, onSizeError,maxFiles,onCountError,disabled]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if(disabled){e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='none';return}
    const hasStash = e.dataTransfer.types.includes(STASH_DRAG_TYPE)
    const hasFiles = e.dataTransfer.types.includes('Files')
    if (hasStash || hasFiles) {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [disabled])

  return (
    <div
      onDropCapture={handleDropCapture}
      onDragOver={handleDragOver}
      style={{ display: 'inline-block', width: '100%' }}
    >
      {children}
    </div>
  )
}
