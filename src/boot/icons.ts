import { defineBoot } from '#q-app'
import {
  matArrowDownward,
  matArrowUpward,
  matCheckCircle,
  matClose,
  matEdit,
  matError,
  matExpandMore,
  matHourglassEmpty,
  matImage,
  matInfo,
  matKeyboardArrowDown,
  matKeyboardArrowUp,
  matQrCode2,
  matSearch,
  matSwapVert,
  matTune,
  matWarning,
} from '@quasar/extras/material-icons'
import { outlinedInfo } from '@quasar/extras/material-icons-outlined'

// TODO: Replace icon-name strings with direct SVG imports for compile-time checking.
// Note: Until then, add every new icon name here; unmapped names render as literal text.
const appIcons: Record<string, string> = {
  arrow_downward: matArrowDownward,
  arrow_upward: matArrowUpward,
  check_circle: matCheckCircle,
  close: matClose,
  edit: matEdit,
  error: matError,
  expand_more: matExpandMore,
  hourglass_empty: matHourglassEmpty,
  image: matImage,
  info: matInfo,
  info_outline: outlinedInfo,
  keyboard_arrow_down: matKeyboardArrowDown,
  keyboard_arrow_up: matKeyboardArrowUp,
  qr_code_2: matQrCode2,
  search: matSearch,
  swap_vert: matSwapVert,
  tune: matTune,
  warning: matWarning,
}

export default defineBoot(({ app }) => {
  app.config.globalProperties.$q.iconMapFn = (iconName) => {
    const icon = appIcons[iconName]
    if (icon) return { icon }
  }
})
