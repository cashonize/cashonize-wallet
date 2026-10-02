import { ref, onMounted, onUnmounted, onActivated, onDeactivated, getCurrentInstance, type Ref } from 'vue'
import { useKeyboardShortcut } from 'quasar'

interface UseWindowSizeReturn {
  width: Ref<number>
  height: Ref<number>
}

// Minimal useWindowSize, adapted from @vueuse/core
// https://github.com/vueuse/vueuse/blob/main/packages/core/useWindowSize/index.ts
export function useWindowSize(): UseWindowSizeReturn {
  const width = ref(window.innerWidth)
  const height = ref(window.innerHeight)

  function update() {
    width.value = window.innerWidth
    height.value = window.innerHeight
  }

  // When called inside a component setup, register lifecycle hooks
  // When called at module scope (e.g. store init), the listener stays for the app lifetime
  if (getCurrentInstance()) {
    onMounted(() => window.addEventListener('resize', update))
    onUnmounted(() => window.removeEventListener('resize', update))
  } else {
    window.addEventListener('resize', update)
  }

  return { width, height }
}

// Ctrl+F (Cmd+F on macOS) opens the view's own search instead of the browser's find. Quasar's
// listener knows nothing of KeepAlive, so a hidden view pauses it; a component outside KeepAlive
// never deactivates and listens for as long as it is mounted.
export function useSearchShortcut(openSearch: () => void) {
  const active = ref(true)
  onActivated(() => { active.value = true })
  onDeactivated(() => { active.value = false })
  useKeyboardShortcut('Mod+F', openSearch, () => ({ disabled: !active.value }))
}
