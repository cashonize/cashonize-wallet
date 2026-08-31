// Renders a QR code as an SVG string, ported from the @bitjson/qr-code web component (MIT).
// The geometry is a verbatim port so the codes keep rendering exactly as before: round modules,
// rounded corner rings, and an optional hole punched in the center for an icon overlay.
//
// The original played its intro animation by driving one Web Animation per module from a
// requestAnimationFrame loop, which for a 41x41 address code means ~680 animations resynced by
// hand every frame. Every preset only ever staggers its elements by a delay, so instead we bake
// that delay into each element as an inline animation-delay and let CSS keyframes (in qrCode.vue)
// run the animation, leaving no per-frame work at all.

import qrcode from 'qrcode-generator';
import type { QRCodeAnimationName } from 'src/interfaces/interfaces';

/** Quiet zone around the code, in modules. */
const margin = 4;

/** Icon width as a percentage of the code, matching the hole punched by isRemovableCenter. */
export const iconWidthPercentage = 18;

type QrCodeEntity = 'module' | 'position-ring' | 'position-center' | 'icon';

export interface QrCodeSvg {
  svg: string;
  /** Delay for the icon overlay, which sits outside the svg but animates along with it. */
  iconDelayMs: number;
}

/**
 * Distance from the code's center, measured from the corner of the shape nearest that center:
 * a corner ring covers seven modules and its center three, unlike a single module.
 */
function distanceFromCenter(x: number, y: number, count: number, entity: QrCodeEntity) {
  const edgeLength = entity === 'position-ring' ? 7 : entity === 'position-center' ? 3 : 0;
  const center = count / 2;
  const adjustedX = x < center ? x + edgeLength : x > center ? x : x + edgeLength / 2;
  const adjustedY = y < center ? y + edgeLength : y > center ? y : y + edgeLength / 2;
  return Math.hypot(adjustedX - center, adjustedY - center);
}

/**
 * The radial presets animate a transform rather than an opacity, which on several hundred
 * separate svg elements costs enough style recalc per frame to visibly stall a mid-range phone.
 * They stagger by distance from the center, so many modules share a delay: quantising to this
 * step collapses a 41x41 code's modules into a few dozen <g> wrappers that carry the animation
 * between them, which is what keeps the wave at 60Hz on a mid-range phone.
 * A coarser step groups harder but pulls modules further off the wave. At 8ms the steepest frame
 * of the ripple already differs from the ungrouped one on a couple of hundred pixels; 4ms brings
 * that down to a handful and still costs nothing measurable, so it is the balance point.
 * The fade presets stay one animation per module: they are far cheaper already, and grouping an
 * opacity animation rasterises the group through an offscreen buffer, which shifts its edges.
 */
const radialGroupStepMs = 4;

function isRadial(animation: QRCodeAnimationName | 'None') {
  return animation === 'RadialRipple' || animation === 'RadialRippleIn';
}

/** Start offset of one element on the shared timeline, in milliseconds. */
function animationDelay(
  animation: QRCodeAnimationName, x: number, y: number, count: number, entity: QrCodeEntity
) {
  switch (animation) {
    case 'FadeInTopDown':
      return y * 20;
    case 'FadeInCenterOut':
      return distanceFromCenter(x, y, count, entity) * 20;
    case 'MaterializeIn':
      return entity === 'module' ? Math.random() * 200 : 200;
    case 'RadialRipple':
    case 'RadialRippleIn':
      return distanceFromCenter(x, y, count, entity) * 7;
  }
}

/**
 * `maskCenter` punches the hole for the icon overlay; pass it only when an icon is rendered.
 * `animation` of 'None' leaves out the delays entirely, so a static code stays a plain svg.
 */
export function generateQrCodeSvg(
  contents: string, maskCenter: boolean, animation: QRCodeAnimationName | 'None'
): QrCodeSvg {
  const qr = qrcode(/* auto-detect the version to use */ 0, /* highest error correction */ 'H');
  qr.addData(contents);
  qr.make();
  const moduleCount = qr.getModuleCount();
  const pixelSize = moduleCount + margin * 2;
  const coordinateShift = pixelSize / 2;

  const delayAttribute = (x: number, y: number, entity: QrCodeEntity) => {
    if (animation === 'None') return '';
    const delay = animationDelay(animation, x, y, moduleCount, entity);
    return ` style="animation-delay:${Math.round(delay)}ms"`;
  };

  // Only numbers derived from the encoder may be interpolated into this markup. It is rendered
  // with v-html, so any string reaching it becomes an injection point: a <title> holding the
  // contents, say, would be an XSS in the payment request, whose uri carries a typed message.
  // The contents reach qr.addData above and nothing else.
  const svg = `
    <svg
        version="1.1"
        xmlns="http://www.w3.org/2000/svg"
        width="100%"
        height="100%"
        viewBox="${0 - coordinateShift} ${0 - coordinateShift} ${pixelSize} ${pixelSize}"
        preserveAspectRatio="xMinYMin meet">
    <rect
        width="100%"
        height="100%"
        fill="white"
        fill-opacity="0"
        cx="${-coordinateShift}"
        cy="${-coordinateShift}"/>
    ${renderPositionDetectionPatterns()}
    ${renderModules()}
    </svg>`;

  return { svg, iconDelayMs: Math.round(iconDelay()) };

  function iconDelay() {
    if (animation === 'None') return 0;
    return animationDelay(animation, moduleCount / 2, moduleCount / 2, moduleCount, 'icon');
  }

  function renderPositionDetectionPatterns() {
    return `
      ${renderPositionDetectionPattern(margin, margin)}
      ${renderPositionDetectionPattern(moduleCount - 7 + margin, margin)}
      ${renderPositionDetectionPattern(margin, moduleCount - 7 + margin)}
      `;
  }

  function renderPositionDetectionPattern(x: number, y: number) {
    const column = x - margin;
    const row = y - margin;
    return `
      <path class="position-ring" fill="#000"${delayAttribute(column, row, 'position-ring')} d="M${x - coordinateShift} ${y - 0.5 - coordinateShift}h6s.5 0 .5 .5v6s0 .5-.5 .5h-6s-.5 0-.5-.5v-6s0-.5 .5-.5zm.75 1s-.25 0-.25 .25v4.5s0 .25 .25 .25h4.5s.25 0 .25-.25v-4.5s0-.25 -.25 -.25h-4.5z"/>
      <path class="position-center" fill="#000"${delayAttribute(column + 2, row + 2, 'position-center')} d="M${x + 2 - coordinateShift} ${y + 1.5 - coordinateShift}h2s.5 0 .5 .5v2s0 .5-.5 .5h-2s-.5 0-.5-.5v-2s0-.5 .5-.5z"/>
      `;
  }

  function renderModules() {
    // Radial presets carry the delay on a shared wrapper, everything else carries its own.
    const grouped = isRadial(animation);
    const byDelay = new Map<number, string>();
    let svgModules = '';

    for (let column = 0; column < moduleCount; column += 1) {
      const positionX = column + margin;
      for (let row = 0; row < moduleCount; row += 1) {
        if (
          qr.isDark(column, row) &&
          !isPositioningElement(row, column) &&
          !isRemovableCenter(row, column)
        ) {
          const positionY = row + margin;
          const circle = `
            <circle
                class="module"
                fill="#000"${grouped ? '' : delayAttribute(column, row, 'module')}
                cx="${positionX - coordinateShift}"
                cy="${positionY - coordinateShift}"
                r="0.5"/>`;
          if (!grouped) {
            svgModules += circle;
            continue;
          }
          const delay = animationDelay(animation, column, row, moduleCount, 'module');
          const step = Math.round(delay / radialGroupStepMs) * radialGroupStepMs;
          byDelay.set(step, (byDelay.get(step) ?? '') + circle);
        }
      }
    }

    if (!grouped) return svgModules;
    // Every module already scales around the same point, the center of the viewBox, so scaling
    // the wrapper instead of each child leaves the geometry unchanged.
    return [...byDelay.entries()]
      .sort(([a], [b]) => a - b)
      .map(([delay, modules]) => `
        <g class="module-group" style="animation-delay:${delay}ms">${modules}</g>`)
      .join('');
  }

  /** The three corner patterns are drawn as paths instead, so their modules are skipped. */
  function isPositioningElement(row: number, column: number) {
    const elemWidth = 7;
    return row <= elemWidth
      ? column <= elemWidth || column >= moduleCount - elemWidth
      : column <= elemWidth
        ? row >= moduleCount - elemWidth
        : false;
  }

  /**
   * For ErrorCorrectionLevel 'H', up to 30% of the code can be corrected. To
   * be safe, we limit damage to 10%.
   */
  function isRemovableCenter(row: number, column: number) {
    if (!maskCenter) return false;
    const center = moduleCount / 2;
    const safelyRemovableHalf = Math.floor((moduleCount * Math.sqrt(0.1)) / 2);
    return (
      row >= center - safelyRemovableHalf &&
      row <= center + safelyRemovableHalf &&
      column >= center - safelyRemovableHalf &&
      column <= center + safelyRemovableHalf
    );
  }
}
