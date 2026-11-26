export interface PopupWindowBounds {
  left?: number | undefined
  top?: number | undefined
  width?: number | undefined
}

export interface PopupBounds {
  left: number
  top: number
}

// Top-right of the active browser window, with a small margin
export function approvalPopupBounds(
  current: PopupWindowBounds,
  popupWidth: number,
  margin = 16,
): PopupBounds | undefined {
  if (current.left === undefined || current.width === undefined) return undefined
  return {
    left: current.left + current.width - popupWidth - margin,
    top: (current.top ?? 0) + margin,
  }
}
