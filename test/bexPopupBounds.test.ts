import { describe, expect, it } from 'vitest'
import { approvalPopupBounds } from '../src/utils/bex/popupBounds'

describe('approval popup placement', () => {
  it('places a 400px popup at the top-right of the active window', () => {
    expect(approvalPopupBounds({ left: 10, top: 10, width: 1280 }, 400)).toEqual({
      left: 874,
      top: 26,
    })
  })

  it('follows a window on a left monitor instead of clamping to the primary screen', () => {
    expect(approvalPopupBounds({ left: -1920, top: 0, width: 1920 }, 400)).toEqual({
      left: -416,
      top: 16,
    })
  })

  it('leaves placement to Chromium when the window bounds are unavailable', () => {
    expect(approvalPopupBounds({}, 400)).toBeUndefined()
  })
})
