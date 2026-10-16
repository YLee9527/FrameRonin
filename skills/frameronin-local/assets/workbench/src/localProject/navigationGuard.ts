type SaveGuard = () => Promise<void>
const guards = new Set<SaveGuard>()
let navigating = false

export function registerSaveGuard(guard: SaveGuard): () => void {
  guards.add(guard)
  return () => { guards.delete(guard) }
}

/** Save before unmounting an editor. A rejected save keeps the current view. */
export async function navigateWithSave(changeView: () => void): Promise<boolean> {
  if (navigating) return false
  navigating = true
  try {
    for (const guard of guards) await guard()
    changeView()
    return true
  } catch {
    // The editor displays the save error and retains its document.
    return false
  } finally { navigating = false }
}
