// Color helpers for the portfolio chart: extracting a dominant color from a token
// icon and measuring perceptual color distance (OKLab) to keep segments distinct.

function srgbToLinear(channel: number) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number) {
  const c = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(Math.max(c, 0), 1) * 255);
}

function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex(r: number, g: number, b: number) {
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

// Standard sRGB → OKLab conversion (https://bottosson.github.io/posts/oklab/)
function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  ];
}

function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
  ];
}

// Perceptual distance between two hex colors, as OKLab euclidean distance x100
// (matching the scale where >=15 means clearly distinguishable for normal vision)
export function colorDistance(hexA: string, hexB: string) {
  const [L1, a1, b1] = rgbToOklab(...hexToRgb(hexA));
  const [L2, a2, b2] = rgbToOklab(...hexToRgb(hexB));
  return Math.sqrt((L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2) * 100;
}

// Clamp a color's OKLab lightness into a band, so icon colors stay readable
// against the current (light or dark) surface
export function clampColorLightness(hex: string, minL: number, maxL: number) {
  const [L, a, b] = rgbToOklab(...hexToRgb(hex));
  const clamped = Math.min(Math.max(L, minL), maxL);
  if (clamped === L) return hex;
  return rgbToHex(...oklabToRgb(clamped, a, b));
}

// Pick the dominant color from decoded icon pixels: bucket colorful pixels by hue
// and average the largest bucket. Returns null when the icon has no dominant hue
// (mostly grey/white/black icons).
function dominantColor(data: Uint8ClampedArray): string | null {
  const buckets = new Map<number, { count: number, r: number, g: number, b: number }>();
  let opaquePixels = 0;

  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] as number) < 200) continue;
    const r = data[i] as number, g = data[i + 1] as number, b = data[i + 2] as number;
    opaquePixels++;

    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    // skip greyish, near-white and near-black pixels, they carry no identity
    if (max - min < 25 || min > 230 || max < 25) continue;

    // hue in degrees, standard RGB→HSL hue formula
    let hue: number;
    if (max === r) hue = ((g - b) / (max - min)) % 6;
    else if (max === g) hue = (b - r) / (max - min) + 2;
    else hue = (r - g) / (max - min) + 4;
    hue = (hue * 60 + 360) % 360;

    const bucketKey = Math.floor(hue / 30);
    const bucket = buckets.get(bucketKey) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(bucketKey, bucket);
  }

  let best: { count: number, r: number, g: number, b: number } | undefined;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket;
  }
  // require the dominant hue to cover a meaningful part of the icon
  if (!best || best.count < opaquePixels * 0.05) return null;

  return rgbToHex(
    Math.round(best.r / best.count),
    Math.round(best.g / best.count),
    Math.round(best.b / best.count)
  );
}

// Load a token icon and extract its dominant color via a small canvas.
// Returns null when the image fails to load, the canvas is CORS-tainted,
// or no dominant hue is found.
export async function extractDominantIconColor(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        resolve(dominantColor(ctx.getImageData(0, 0, size, size).data));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
