/**
 * Where the Pi server lives. Override with `NEXT_PUBLIC_PI_URL` in
 * `.env.local`. When the Next.js app runs on the Pi itself, set this to
 * `http://localhost:8000`.
 */
export const PI_URL =
  process.env.NEXT_PUBLIC_PI_URL?.replace(/\/$/, "") ||
  "http://raspberrypi.local:8000";

export const STREAM_URL = `${PI_URL}/stream`;
export const CAPTURE_URL = `${PI_URL}/capture`;
export const PRINT_URL = `${PI_URL}/print`;

/** Receipt copy. Adjust per shoot — no env var so the values are reviewable. */
export const RECEIPT = {
  brand: "groupdynamics.net",
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
