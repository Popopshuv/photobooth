import { RECEIPT } from "./photoboothConfig";

interface ComposeOptions {
  /** The captured photo (already decoded). */
  photo: HTMLImageElement;
  /** Output canvas width in CSS pixels. Default 800 (works at any DPI). */
  width?: number;
}

/**
 * Compose the printable receipt: brand wordmark on top, the photo, a printed
 * "ticket" block underneath. Returns a freshly drawn canvas that the caller
 * can preview and convert to a Blob.
 *
 * Layout is monospaced and proportional to `width` so the same code prints
 * crisply on a thermal receipt printer (576px) or an inkjet (1200px+).
 */
export async function composeReceipt({
  photo,
  width = 800,
}: ComposeOptions): Promise<HTMLCanvasElement> {
  await document.fonts.ready;

  const pad = Math.round(width * 0.06);
  const photoW = width - pad * 2;
  const photoH = Math.round((photoW * photo.naturalHeight) / photo.naturalWidth);

  const brandSize = Math.round(width * 0.045);
  const bodySize = Math.round(width * 0.026);
  const bodyLineH = Math.round(bodySize * 1.7);

  // Header height: padding + brand line + small gap + rule
  const headerH = pad + brandSize + Math.round(pad * 0.6) + 1;
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
  const footerH = pad + 1 + ruleGap + bodyH + pad;

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

  // Brand wordmark — sentence-case, centered
  ctx.font = `300 ${brandSize}px "ABCMonumentGrotesk", monospace`;
  ctx.textAlign = "center";
  ctx.fillText(RECEIPT.brand, width / 2, pad + brandSize);

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

  // Receipt body — uppercase, left aligned, monospace
  ctx.font = `300 ${bodySize}px "ABCMonumentGrotesk", monospace`;
  ctx.textAlign = "left";
  for (const line of lines) {
    y += bodyLineH;
    ctx.fillText(line, pad, y);
  }

  return canvas;
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
