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

  const brandSize = Math.round(width * 0.05);
  // Bumped from 0.026 — at 0.026 × 58mm ≈ 1.5mm tall, the thermal head
  // dropped strokes on the lighter monospace weight. 0.034 ≈ 2.0mm.
  const bodySize = Math.round(width * 0.034);
  const bodyLineH = Math.round(bodySize * 1.6);

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
