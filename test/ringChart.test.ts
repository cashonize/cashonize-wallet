import { describe, it, expect } from 'vitest'
import { ringSegmentPath } from '../src/utils/ringChart'

// the points of a path, in the order it visits them
function points(path: string): { x: number, y: number }[] {
  // a point follows a move, a line, or an arc's radii and flags
  const coordinates = [...path.matchAll(/(?:M|L|A [\d.]+ [\d.]+ 0 [01] [01]) (-?[\d.]+) (-?[\d.]+)/g)]
  return coordinates.map(match => ({ x: Number(match[1]), y: Number(match[2]) }))
}
const distance = (a: { x: number, y: number }, b: { x: number, y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

describe('ringSegmentPath', () => {
  it('leaves a gap of one width between two segments, outside and inside', () => {
    const gap = 3
    // outer start, outer end, inner end, inner start
    const first = points(ringSegmentPath(0, 30, gap))
    const second = points(ringSegmentPath(30, 100, gap))
    expect(distance(first[1]!, second[0]!)).toBeCloseTo(gap, 2)
    expect(distance(first[2]!, second[3]!)).toBeCloseTo(gap, 2)
  })

  it('takes the long way round for a segment over half the circle', () => {
    expect(ringSegmentPath(0, 70, 3)).toMatch(/A [\d.]+ [\d.]+ 0 1 1 /)
    expect(ringSegmentPath(0, 30, 3)).toMatch(/A [\d.]+ [\d.]+ 0 0 1 /)
  })

  it('draws a lone segment as a closed ring', () => {
    // also a rounding error short of the whole, where a single arc's ends would meet
    for (const end of [100, 99.99999999999999]) {
      const ring = ringSegmentPath(0, end, 0)
      expect(ring.match(/Z/g)).toHaveLength(2)
      expect(ring).not.toContain('NaN')
    }
  })
})
