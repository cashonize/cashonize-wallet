// Deterministic blocky identicon generator
// Adapted from @download/blockies (https://github.com/nickytonline/blockies)
// Generates unique canvas icons from a seed string using Xorshift PRNG
// Ported to TypeScript with renamed variables and a Seed tuple type
// for the PRNG state so array access is type-safe without ts-ignore

interface BlockiesOptions {
  seed?: string;
  size?: number;
  scale?: number;
  color?: string;
  bgcolor?: string;
  spotcolor?: string;
}

type Seed = [number, number, number, number];

// Xorshift PRNG: [x, y, z, w] 32-bit values
const randseed: Seed = [0, 0, 0, 0];

function seedrand(seed: string) {
  randseed.fill(0);
  for (let i = 0; i < seed.length; i++) {
    const idx = (i % 4) as 0 | 1 | 2 | 3;
    randseed[idx] = ((randseed[idx] << 5) - randseed[idx]) + seed.charCodeAt(i);
  }
}

function rand() {
  const temp = randseed[0] ^ (randseed[0] << 11);
  randseed[0] = randseed[1];
  randseed[1] = randseed[2];
  randseed[2] = randseed[3];
  randseed[3] = (randseed[3] ^ (randseed[3] >> 19) ^ temp ^ (temp >> 8));
  return (randseed[3] >>> 0) / ((1 << 31) >>> 0);
}

function createColor() {
  const hue = Math.floor(rand() * 360);
  const saturation = ((rand() * 60) + 40) + '%';
  const lightness = ((rand() + rand() + rand() + rand()) * 25) + '%';
  return 'hsl(' + hue + ',' + saturation + ',' + lightness + ')';
}

function createImageData(size: number) {
  const dataWidth = Math.ceil(size / 2);
  const mirrorWidth = size - dataWidth;
  const data: number[] = [];

  for (let y = 0; y < size; y++) {
    let row: number[] = [];
    for (let x = 0; x < dataWidth; x++) {
      row[x] = Math.floor(rand() * 2.3);
    }
    const mirror = row.slice(0, mirrorWidth);
    mirror.reverse();
    row = row.concat(mirror);
    data.push(...row);
  }

  return data;
}

function buildOpts(opts: BlockiesOptions) {
  const seed = opts.seed || Math.floor((Math.random() * Math.pow(10, 16))).toString(16);
  seedrand(seed);
  return {
    size: opts.size || 8,
    scale: opts.scale || 4,
    color: opts.color || createColor(),
    bgcolor: opts.bgcolor || createColor(),
    spotcolor: opts.spotcolor || createColor(),
  };
}

export function createIcon(opts: BlockiesOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const resolved = buildOpts(opts);
  const imageData = createImageData(resolved.size);
  const width = Math.sqrt(imageData.length);

  canvas.width = canvas.height = resolved.size * resolved.scale;

  const canvasContext = canvas.getContext('2d')!;
  canvasContext.fillStyle = resolved.bgcolor;
  canvasContext.fillRect(0, 0, canvas.width, canvas.height);
  canvasContext.fillStyle = resolved.color;

  for (let i = 0; i < imageData.length; i++) {
    if (imageData[i]) {
      const row = Math.floor(i / width);
      const col = i % width;
      canvasContext.fillStyle = (imageData[i] == 1) ? resolved.color : resolved.spotcolor;
      canvasContext.fillRect(col * resolved.scale, row * resolved.scale, resolved.scale, resolved.scale);
    }
  }

  return canvas;
}
