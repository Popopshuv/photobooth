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
   * Side padding as a fraction of width. Doubles as a "safe zone" — most
   * printers (especially label printers like the Brother VC-500W) have a
   * hardware unprintable margin and `lp -o fit-to-page` doesn't account for
   * it, so we build the buffer into the canvas itself. 0.12 ≈ 12% per side
   * survives the typical 3-4mm edge clip.
   */
  padPct: 0.12,
  lines: [
    "GROUP DYNAMICS",
    "SALT LAKE CITY, UTAH 84105",
    "EST. 2026",
    "",
    "ITEM ............ 1x PORTRAIT",
    "FORMAT .......... 4 x 6 RECEIPT",
    "",
    "THANK YOU FOR SITTING.",
  ],
} as const;
