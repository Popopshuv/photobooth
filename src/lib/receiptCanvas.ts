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

  const brandSize = Math.round(width * 0.045);
  const bodySize = Math.round(width * 0.026);
  const bodyLineH = Math.round(bodySize * 1.7);

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
  const ticket = `TICKET # ${Math.floor(Math.random() * 9000 + 1000)}`;

  const lines = [
    ...RECEIPT.lines,
    "",
    `DATE ............ ${stamp} UTC`,
    ticket,
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

  // Photo
  y += ruleGap;
  ctx.drawImage(photo, pad, y, photoW, photoH);
  y += photoH + ruleGap;

  // Rule above receipt body
  ctx.fillRect(pad, y, width - pad * 2, 1);
  y += 1 + ruleGap;

  // Receipt body — uppercase, left aligned, monospace.
  ctx.font = `300 ${bodySize}px "ABCMonumentGrotesk", monospace`;
  ctx.textAlign = "left";
  for (const line of lines) {
    y += bodyLineH;
    ctx.fillText(line, textPad, y);
  }

  // Resample to the printer's native pixel grid and dither to 1-bit so the
  // preview matches the print exactly (no double-dither inside CUPS, no
  // color-vs-thermal mismatch on screen).
  return ditherToThermal(canvas, width);
}

/**
 * Bilinearly downsamples the high-res canvas to the printer's native
 * resolution, then runs Floyd–Steinberg dither so every pixel is either
 * 0 (black) or 255 (white). The returned canvas is at native print dots,
 * matching what `rastertozj` will hand the printer one-for-one.
 */
function ditherToThermal(
  source: HTMLCanvasElement,
  logicalWidth: number,
): HTMLCanvasElement {
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
  const octx = out.getContext("2d");
  if (!octx) throw new Error("dither canvas: 2D context unavailable");
  // High-quality bilinear so text edges become gradients the dither can
  // distribute across pixels — the source is `logicalWidth × dpr` wide and
  // we downsample to `targetW`, almost always a 4:1 reduction.
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, targetW, targetH);
  octx.drawImage(source, 0, 0, targetW, targetH);
  // logicalWidth is unused once the bilinear downsample lands; held in the
  // signature in case future tweaks want to thread it through.
  void logicalWidth;

  const img = octx.getImageData(0, 0, targetW, targetH);
  const data = img.data;
  // Floyd–Steinberg in a single grayscale buffer (one float per pixel) so
  // we don't pay 4x the memory traffic on the diffusion step.
  const gray = new Float32Array(targetW * targetH);
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4;
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const i = y * targetW + x;
      const old = gray[i];
      const next = old < 128 ? 0 : 255;
      gray[i] = next;
      const err = old - next;
      if (x + 1 < targetW) gray[i + 1] += (err * 7) / 16;
      if (y + 1 < targetH) {
        if (x > 0) gray[i + targetW - 1] += (err * 3) / 16;
        gray[i + targetW] += (err * 5) / 16;
        if (x + 1 < targetW) gray[i + targetW + 1] += (err * 1) / 16;
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
  octx.putImageData(img, 0, 0);
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
