type SaveGuard = () => Promise<void>
const guards = new Set<SaveGuard>()
let navigating = false

export function registerSaveGuard(guard: SaveGuard): () => void {
  guards.add(guard)
  return () => { guards.delete(guard) }
}

/** Save before unmounting an editor. A rejected save keeps the current view. */
export async function navigateWithSave(changeView: () => void): Promise<void> {
  if (navigating) return
  navigating = true
  try {
    for (const guard of guards) await guard()
    changeView()
  } catch {
    // The editor displays the save error and retains its document.
  } finally { navigating = false }
}
