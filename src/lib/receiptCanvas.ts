import { RECEIPT } from "./photoboothConfig";

type PhotoSource = HTMLImageElement | HTMLCanvasElement;

interface ComposeOptions {
  /** The captured photo, either a decoded image or a pre-rendered canvas. */
  photo: PhotoSource;
  /** Output canvas width in CSS pixels. Defaults to `RECEIPT.widthPx`. */
  width?: number;
  /** Side padding for the photo / rules. Defaults to `RECEIPT.padPct`. */
  padPct?: number;
  /** Extra-wide side padding for text. Defaults to `RECEIPT.textPadPct`. */
  textPadPct?: number;
}

function photoDims(src: PhotoSource): { w: number; h: number } {
  if (src instanceof HTMLCanvasElement) return { w: src.width, h: src.height };
  return { w: src.naturalWidth, h: src.naturalHeight };
}

/**
 * Prep the captured photo for thermal output:
 *   1. Convert to luminance.
 *   2. Apply a gamma curve so mid-tones survive the printer's 50% threshold
 *      (without this, hair / clothing / shadows collapse to solid black).
 *   3. Floyd–Steinberg dither to 1-bit so gradients render as scattered
 *      black/white dots rather than blocky black/white regions.
 *
 * Returns a fresh canvas — the source is left untouched so the React tree
 * still holds the original decoded photo.
 */
function processPhotoForThermal(
  photo: PhotoSource,
  gamma: number,
): HTMLCanvasElement {
  const dims = photoDims(photo);
  const c = document.createElement("canvas");
  c.width = dims.w;
  c.height = dims.h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("processPhotoForThermal: 2D context unavailable");
  ctx.drawImage(photo, 0, 0);

  const img = ctx.getImageData(0, 0, dims.w, dims.h);
  const data = img.data;

  // Gamma LUT — 256 entries so we don't pay a Math.pow per pixel.
  const inv = 1 / gamma;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.round(255 * Math.pow(i / 255, inv));
  }

  // Pull RGB → luminance, apply gamma, store as floats so the dither's
  // error-diffusion accumulator has somewhere to spill subpixel error.
  const w = dims.w;
  const h = dims.h;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4;
    const lum = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    gray[i] = lut[Math.round(lum)];
  }

  // Floyd–Steinberg.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = gray[i];
      const next = old < 128 ? 0 : 255;
      gray[i] = next;
      const err = old - next;
      if (x + 1 < w) gray[i + 1] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) gray[i + w - 1] += (err * 3) / 16;
        gray[i + w] += (err * 5) / 16;
        if (x + 1 < w) gray[i + w + 1] += (err * 1) / 16;
      }
    }
  }

  for (let i = 0; i < gray.length; i++) {
    const p = i * 4;
    const v = gray[i];
    data[p] = v;
    data[p + 1] = v;
    data[p + 2] = v;
    data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Compose the printable receipt: brand wordmark on top, the photo, a printed
 * "ticket" block underneath. Returns a freshly drawn canvas that the caller
 * can preview and convert to a Blob.
 *
 * Layout is monospaced and proportional to `width` so the same code prints
 * crisply on a thermal receipt printer (576px) or an inkjet (1200px+). The
 * `padPct` is also the safe-zone against printer edge-clipping.
 */
export async function composeReceipt({
  photo,
  width = RECEIPT.widthPx,
  padPct = RECEIPT.padPct,
  textPadPct = RECEIPT.textPadPct,
}: ComposeOptions): Promise<HTMLCanvasElement> {
  const pad = Math.round(width * padPct);
  const textPad = Math.round(width * textPadPct);
  // Modest top + bottom quiet zones. Thermal printers don't clip the
  // leading/trailing edge the way label stock does, so we just need
  // enough whitespace for the wordmark and footer to breathe.
  const topQuiet = Math.round(width * 0.06);
  const bottomQuiet = Math.round(width * 0.06);
  const photoW = width - pad * 2;
  const dims = photoDims(photo);
  const photoH = Math.round((photoW * dims.h) / dims.w);

  const brandSize = Math.round(width * 0.06);
  // ABC Mono Light's thin strokes drop out on thermal at small sizes — each
  // stroke needs at least ~2 dots to print cleanly. 0.045 × 58mm ≈ 2.6mm
  // tall (~21 dots at 8 dots/mm), which gives the strokes enough mass.
  const bodySize = Math.round(width * 0.045);
  // Bigger line height ratio so two-column rows have real air between them
  // and ascenders/descenders never visually touch on print.
  const bodyLineH = Math.round(bodySize * 1.9);

  // Force the webfont to load for the exact sizes we'll draw with. Canvas
  // silently falls back to plain monospace if the font face isn't loaded
  // yet for that specific (weight, size) tuple.
  await Promise.all([
    document.fonts.load(`300 ${brandSize}px "ABCMonumentGrotesk"`),
    document.fonts.load(`300 ${bodySize}px "ABCMonumentGrotesk"`),
  ]);
  await document.fonts.ready;

  // Header height: top quiet zone + brand line + small gap + rule
  const headerH = topQuiet + brandSize + Math.round(pad * 0.6) + 1;
  const ruleGap = Math.round(pad * 0.5);

  // Build the dynamic receipt block with date stamp
  const now = new Date();
  const stamp = now
    .toISOString()
    .replace("T", " ")
    .replace(/\..+/, "")
    .toUpperCase();
  const ticketNum = Math.floor(Math.random() * 9000 + 1000);

  type ReceiptLine = string | null | readonly [string, string];
  const lines: ReceiptLine[] = [
    ...RECEIPT.lines,
    null,
    ["DATE", `${stamp} UTC`],
    ["TICKET", `#${ticketNum}`],
  ];

  const bodyH = lines.length * bodyLineH;
  const footerH = pad + 1 + ruleGap + bodyH + bottomQuiet;

  const height = headerH + ruleGap + photoH + ruleGap + 1 + footerH;

  const canvas = document.createElement("canvas");
  // Render at 2x for print sharpness, then we'll downscale on POST if needed.
  const dpr = 2;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  // Display sizing is left to the caller — set width/height in CSS as needed.

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire 2D context");
  ctx.scale(dpr, dpr);

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#1a1a1a";
  ctx.textBaseline = "alphabetic";

  // Brand wordmark — sentence-case, left-aligned with the rest of the body.
  // Uses textPad so it has more breathing room from the right edge than the
  // image; printers (especially label printers) clip text more obviously.
  ctx.font = `300 ${brandSize}px "ABCMonumentGrotesk", monospace`;
  ctx.textAlign = "left";
  ctx.fillText(RECEIPT.brand, textPad, topQuiet + brandSize);

  // Rule under header
  let y = headerH;
  ctx.fillRect(pad, y, width - pad * 2, 1);

  // Photo — gamma-lifted + Floyd–Steinberg dithered so mid-tones become
  // scattered dots instead of a solid black silhouette under the printer's
  // hard 50% threshold.
  const processedPhoto = processPhotoForThermal(photo, RECEIPT.photoGamma);
  y += ruleGap;
  ctx.drawImage(processedPhoto, pad, y, photoW, photoH);
  y += photoH + ruleGap;

  // Rule above receipt body
  ctx.fillRect(pad, y, width - pad * 2, 1);
  y += 1 + ruleGap;

  // Receipt body — strings render full-width, tuples render as a real
  // two-column row (label flush left, value flush right). Blank slots
  // (null) advance the y cursor for visual separation.
  ctx.font = `300 ${bodySize}px "ABCMonumentGrotesk", monospace`;
  for (const line of lines) {
    y += bodyLineH;
    if (line === null) continue;
    if (typeof line === "string") {
      ctx.textAlign = "left";
      ctx.fillText(line, textPad, y);
      continue;
    }
    const [label, value] = line;
    ctx.textAlign = "left";
    ctx.fillText(label, textPad, y);
    ctx.textAlign = "right";
    ctx.fillText(value, width - textPad, y);
  }
  ctx.textAlign = "left";

  // Resample to the printer's native pixel grid so the preview shows the
  // same per-dot layout the printer will see. Final 1-bit conversion is
  // left to rastertozj on the Pi — it has settings tuned for the hardware
  // and dithering twice produces harsh noise.
  return resampleToNative(canvas);
}

/**
 * Bilinearly downsample the high-res compose canvas to the printer's native
 * resolution. No dither — `rastertozj` will threshold to 1-bit at the printer.
 */
function resampleToNative(source: HTMLCanvasElement): HTMLCanvasElement {
  const targetW = Math.max(
    32,
    Math.round(RECEIPT.printWidthMm * RECEIPT.printDotsPerMm),
  );
  const targetH = Math.max(
    32,
    Math.round((source.height / source.width) * targetW),
  );

  const out = document.createElement("canvas");
  out.width = targetW;
  out.height = targetH;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("resample canvas: 2D context unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(source, 0, 0, targetW, targetH);
  return out;
}

/** Convert a canvas to a PNG Blob. */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
      "image/png",
    );
  });
}
