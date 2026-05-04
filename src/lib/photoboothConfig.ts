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
   * Padding for text (brand wordmark + body lines). Matches `padPct` so
   * the wordmark and receipt copy line up flush with the left edge of
   * the photo above them — no double-indent.
   */
  textPadPct: 0.04,
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
  /**
   * Extra blank paper appended below the last printed row, in millimeters.
   * Thermal printers without an auto-cutter park the last printed line a
   * few cm down inside the body — without this, you have to manually feed
   * paper out before tearing or the content gets sliced off. Bump if your
   * tear bar is further above the print head; drop to save paper.
   */
  tearOffMm: 50,
  /**
   * Visible gap between body rows on the printed page, in millimeters.
   * Independent of font size so spacing reads consistently regardless
   * of text scale tweaks.
   */
  bodyGapMm: 10,
  /**
   * Vertical breathing room (mm) above AND below the photo. Adds whitespace
   * between the header rule and the photo, and the photo and the body rule.
   */
  photoMarginMm: 8,
  /**
   * Gamma applied to the captured photo before composing onto the receipt.
   * Thermal printers threshold at ~50% gray, so anything mid-tone or darker
   * collapses to pure black on print — a normal portrait turns into a
   * silhouette. Values >1 lift mid-tones and shadows. 1.8 ≈ "lift one stop";
   * push to 2.2 if the print is still mostly black, drop to 1.4 if highlights
   * are blowing out.
   */
  photoGamma: 1.8,
  /**
   * Lines in the receipt body. Strings render full-width; tuples render as
   * a real two-column table (label flush left, value flush right) so the
   * layout doesn't depend on monospace dot-leaders, which the thermal
   * head can drop. `null` is a blank-line spacer.
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
} as const;
