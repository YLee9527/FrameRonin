import {
  createContext,
  useCallback,
  useContext,
  useId,
  useState,
} from 'react'
import {materializeStashUrl} from './transfer'

export interface StashItem {
  id: string
  url: string
  name?: string
}

const STORAGE_KEY = 'frameronin_stash'

function loadFromSession(): StashItem[] {
  try {
    const s = sessionStorage.getItem(STORAGE_KEY)
    if (!s) return []
    const parsed = JSON.parse(s) as StashItem[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveToSession(items: StashItem[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    /* ignore */
  }
}

interface ImageStashContextValue {
  items: StashItem[]
  addImage: (url: string, name?: string, releaseSource?:boolean) => Promise<void>
  removeImage: (id: string) => void
  clearAll: () => void
}

const ImageStashContext = createContext<ImageStashContextValue | null>(null)

export function ImageStashProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<StashItem[]>(() => loadFromSession())
  const idSeed = useId()

  const addImage = useCallback(
    async (url: string, name?: string, releaseSource=false) => {
      const id = `${idSeed}-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const persistUrl=await materializeStashUrl(url,releaseSource)
      setItems((prev) => {
        const next = [...prev, { id, url: persistUrl, name }]
        saveToSession(next)
        return next
      })
    },
    [idSeed]
  )

  const removeImage = useCallback((id: string) => {
    setItems((prev) => {
      const item = prev.find((i) => i.id === id)
      if (item?.url.startsWith('blob:')) URL.revokeObjectURL(item.url)
      const next = prev.filter((i) => i.id !== id)
      saveToSession(next)
      return next
    })
  }, [])

  const clearAll = useCallback(() => {
    setItems((prev) => {
      prev.forEach((i) => {
        if (i.url.startsWith('blob:')) URL.revokeObjectURL(i.url)
      })
      saveToSession([])
      return []
    })
  }, [])

  return (
    <ImageStashContext.Provider value={{ items, addImage, removeImage, clearAll }}>
      {children}
    </ImageStashContext.Provider>
  )
}

// The provider and consumer hook intentionally share this context instance.
// eslint-disable-next-line react-refresh/only-export-components
export function useImageStash() {
  const ctx = useContext(ImageStashContext)
  if (!ctx) throw new Error('useImageStash must be used within ImageStashProvider')
  return ctx
}
