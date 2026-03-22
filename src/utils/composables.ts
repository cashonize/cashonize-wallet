// Minimal useWindowSize composable, adapted from @vueuse/core
// https://github.com/vueuse/vueuse/blob/main/packages/core/useWindowSize/index.ts
import { ref, onMounted, onUnmounted, getCurrentInstance, type Ref } from 'vue'

interface UseWindowSizeReturn {
  width: Ref<number>
  height: Ref<number>
}

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
