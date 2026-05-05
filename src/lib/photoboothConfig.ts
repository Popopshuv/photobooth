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

/**
 * Receipt copy. The browser POSTs `brand`, `lines`, and `feedLines` to
 * the Pi server, which composes the receipt using the printer's native
 * ESC/POS commands — no canvas, no DPI, no CUPS. Photo printing happens
 * server-side too. Edit the strings below to change what prints.
 */
export const RECEIPT = {
  brand: "groupdynamics.net",
  /**
   * Lines in the receipt body, in print order.
   *   - `string`              → renders full-width
   *   - `[label, value]`      → renders as a two-column row (label left,
   *                             value right) using monospace alignment
   *   - `null`                → blank-line spacer
   * The server auto-appends `DATE` and `TICKET` rows at the end.
   */
  lines: [
    "GROUP DYNAMICS",
    "SALT LAKE CITY, UTAH",
    "EST. 2026",
    null,
    ["ITEM", "1x PORTRAIT"],
    ["FORMAT", "THERMAL RECEIPT"],
    null,
    "THANK YOU FOR SITTING.",
  ] as ReadonlyArray<string | null | readonly [string, string]>,
  /**
   * Blank line feeds added after the last printed row so the receipt
   * clears the manual tear bar. Thermal printers without auto-cutters
   * park the last line down inside the body — feed past it.
   */
  feedLines: 6,
  /**
   * How many photos to capture per session. The server stacks them
   * vertically into a strip before printing — set to 1 for a single
   * portrait, 4 for the classic photobooth strip.
   */
  photoCount: 4,
  /**
   * Pause between an individual capture's flash and the next countdown
   * (ms). Gives users a beat to reset their pose without rushing them.
   */
  betweenPhotosMs: 600,
} as const;
