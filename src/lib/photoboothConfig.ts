/**
 * Where the Pi server lives.
 *
 * Resolution order, first match wins:
 *   1. `NEXT_PUBLIC_PI_URL` (explicit override — set in `.env.local`)
 *   2. The current page's host on port 8000 (the common case: Next.js and the
 *      Pi server are both on the Pi, so just reuse whatever host the browser
 *      already used to reach this page — `localhost`, the Pi's LAN IP, etc.)
 *   3. `http://raspberrypi.local:8000` as a last-ditch SSR fallback. Never
 *      reached from the browser at runtime.
 */
export function getPiBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_PI_URL?.replace(/\/$/, "");
  if (envUrl) return envUrl;
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }
  return "http://raspberrypi.local:8000";
}

export const streamUrl = () => `${getPiBaseUrl()}/stream`;
export const captureUrl = () => `${getPiBaseUrl()}/capture`;
export const printUrl = () => `${getPiBaseUrl()}/print`;

/** Receipt copy + print geometry. Adjust per shoot. */
export const RECEIPT = {
  brand: "groupdynamics.net",
  /**
   * Output canvas width in CSS pixels. The receipt scales proportionally
   * from this. Bump up for larger paper, down for narrow label/thermal stock.
   */
  widthPx: 800,
  /**
   * Side padding as a fraction of width — used by the photo and rules.
   * Thermal printers have ~0 unprintable margin (the head spans the full
   * paper width), so this is purely visual breathing room, not a clip
   * safety zone. Bump up if switching back to a label/inkjet printer.
   */
  padPct: 0.04,
  /**
   * Extra-wide padding for text (brand wordmark + body lines). Slightly
   * inset from the photo so characters don't hug the paper edge.
   */
  textPadPct: 0.06,
  /**
   * Physical print width in millimeters. Used to tell CUPS the exact custom
   * media size (`Custom.<W>x<H>mm`) so it doesn't fit-to-page and clip the
   * bottom of the receipt. Set to your stock width:
   *   58mm mini thermal          = 58
   *   80mm thermal receipt       = 80
   *   2" / Brother VC-500W ZINK  = 50.8
   */
  printWidthMm: 58,
  /**
   * Native print resolution in dots-per-millimeter. Most 58mm/80mm thermal
   * heads are 203 DPI ≈ 8 dots/mm. Used to size the composed canvas to the
   * printer's native pixel grid so what you see in the preview is what
   * gets printed (no resampling step inside CUPS).
   */
  printDotsPerMm: 8,
  lines: [
    "GROUP DYNAMICS",
    "SALT LAKE CITY, UTAH 84105",
    "EST. 2026",
    "",
    "ITEM ............ 1x PORTRAIT",
    "FORMAT .......... 2 x 4 RECEIPT",
    "",
    "THANK YOU FOR SITTING.",
  ],
} as const;
