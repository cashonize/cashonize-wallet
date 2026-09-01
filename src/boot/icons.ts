import { defineBoot } from '#q-app'
import {
  matAcUnit,
  matAddCircle,
  matArchive,
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
  matLock,
  matLockOpen,
  matMoreVert,
  matOpenInNew,
  matHistory,
  matDelete,
  matQrCode2,
  matSearch,
  matSend,
  matSwapVert,
  matTune,
  matUnarchive,
  matWarning,
} from '@quasar/extras/material-icons'
import { outlinedInfo } from '@quasar/extras/material-icons-outlined'

// TODO: Replace icon-name strings with direct SVG imports for compile-time checking.
// Note: Until then, add every new icon name here; unmapped names render as literal text.
const appIcons: Record<string, string> = {
  ac_unit: matAcUnit,
  add_circle: matAddCircle,
  archive: matArchive,
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
  history: matHistory,
  info_outline: outlinedInfo,
  keyboard_arrow_down: matKeyboardArrowDown,
  keyboard_arrow_up: matKeyboardArrowUp,
  lock: matLock,
  lock_open: matLockOpen,
  more_vert: matMoreVert,
  open_in_new: matOpenInNew,
  qr_code_2: matQrCode2,
  search: matSearch,
  delete: matDelete,
  send: matSend,
  swap_vert: matSwapVert,
  tune: matTune,
  unarchive: matUnarchive,
  warning: matWarning,
}

export default defineBoot(({ app }) => {
  app.config.globalProperties.$q.iconMapFn = (iconName) => {
    const icon = appIcons[iconName]
    if (icon) return { icon }
  }
})
