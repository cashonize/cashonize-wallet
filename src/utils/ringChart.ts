// Path geometry for the portfolio's ring chart, in css pixels at its full size. The size is odd
// and the radii end on a half, so the centre sits mid-pixel and a 3px gap at the top of the ring
// falls on whole pixels: three of pure background, with no half-covered column beside them.

export const ringChartSize = 261
const center = ringChartSize / 2
const outerRadius = 110.5
const innerRadius = 85.5
const midRadius = (outerRadius + innerRadius) / 2

// a width in pixels along the ring's centre line, as a percentage of the circle
export function ringPercent(pixels: number): number {
  return (pixels / (2 * Math.PI * midRadius)) * 100
}

// angles run clockwise from the top
function point(radius: number, angle: number): string {
  const x = center + radius * Math.sin(angle)
  const y = center - radius * Math.cos(angle)
  return `${x.toFixed(3)} ${y.toFixed(3)}`
}

function circle(radius: number, sweep: 0 | 1): string {
  const top = point(radius, 0)
  const bottom = point(radius, Math.PI)
  return `M ${top} A ${radius} ${radius} 0 1 ${sweep} ${bottom} A ${radius} ${radius} 0 1 ${sweep} ${top} Z`
}

// One segment of the ring as a filled shape, from start to end in percent of the circle. Half the
// gap, in pixels, is cut from each end with its sides parallel, so the break between two segments
// is a line of one width. Not a dashed circle: Chromium measures a circle slightly short, so
// dashes scaled by pathLength end early and the pattern starts again before the top.
export function ringSegmentPath(start: number, end: number, gap: number): string {
  // An arc cannot close on itself, so the whole ring is two circles, the inner one cut out. A sum
  // of shares can land a rounding error short of 100, where the arc's ends would meet and vanish.
  if (end - start > 100 - 1e-6) return `${circle(outerRadius, 1)} ${circle(innerRadius, 0)}`
  const startAngle = (start / 100) * 2 * Math.PI
  const endAngle = (end / 100) * 2 * Math.PI
  const outerInset = Math.asin(gap / 2 / outerRadius)
  const innerInset = Math.asin(gap / 2 / innerRadius)
  const outerLarge = endAngle - startAngle - 2 * outerInset > Math.PI ? 1 : 0
  const innerLarge = endAngle - startAngle - 2 * innerInset > Math.PI ? 1 : 0
  return [
    `M ${point(outerRadius, startAngle + outerInset)}`,
    `A ${outerRadius} ${outerRadius} 0 ${outerLarge} 1 ${point(outerRadius, endAngle - outerInset)}`,
    `L ${point(innerRadius, endAngle - innerInset)}`,
    `A ${innerRadius} ${innerRadius} 0 ${innerLarge} 0 ${point(innerRadius, startAngle + innerInset)}`,
    'Z',
  ].join(' ')
}
