"""Photobooth server — runs on the Raspberry Pi.

Exposes the CSI camera (Freenove / Pi camera via libcamera/picamera2) and the
USB thermal printer over a small HTTP API the Next.js app talks to from the
browser:

  GET  /health    -> {"ok": true, ...}
  GET  /stream    -> multipart MJPEG stream (drop into <img src=...>)
  GET  /capture   -> single JPEG still (Content-Type: image/jpeg)
                     Background is removed and composited onto white so the
                     thermal print looks clean — toggle with PHOTOBOOTH_REMOVE_BG.
  POST /print     -> body: image/png|image/jpeg, sends to printer.
                     Default path is direct ESC/POS over USB via python-escpos
                     — same protocol every retail POS system uses. CUPS is
                     available as a fallback for installs that need it.

Run:
    python3 app.py            # binds 0.0.0.0:8000

Env:
    PHOTOBOOTH_PORT          default 8000
    PHOTOBOOTH_PRINT_METHOD  "escpos" (default) | "cups". escpos talks
                             directly to the printer over USB — fastest, no
                             filter chain, no fit-to-page surprises. Set to
                             "cups" to fall back to the old `lp` path.
    PHOTOBOOTH_PRINTER_VID   USB vendor id of the thermal printer (hex).
                             Default 0x6868 (Tech CLa58). Find yours with
                             `lsusb`.
    PHOTOBOOTH_PRINTER_PID   USB product id (hex). Default 0x0200.
    PHOTOBOOTH_PRINTER_FEED  Number of blank lines fed after the receipt
                             so the tear bar lands below content. Default 6.
    PHOTOBOOTH_PRINTER       CUPS printer name (only used if METHOD=cups)
    PHOTOBOOTH_WIDTH         stream width  (default 1280)
    PHOTOBOOTH_HEIGHT        stream height (default 720)
    PHOTOBOOTH_STILL_W       still width   (default 2304)
    PHOTOBOOTH_STILL_H       still height  (default 1296)
    PHOTOBOOTH_REMOVE_BG     "1"/"0" — run rembg on captures (default 1)
    PHOTOBOOTH_REMBG_MODEL   rembg model name (default "u2netp" — small/fast)
"""

from __future__ import annotations

import io
import json
import os
import random
import subprocess
import tempfile
import threading
import time
from typing import Optional

from flask import Flask, Response, jsonify, request
from flask_cors import CORS
from PIL import Image, ImageDraw, ImageFont, ImageOps

try:
    from picamera2 import Picamera2
    from picamera2.encoders import MJPEGEncoder
    from picamera2.outputs import FileOutput
except ImportError as exc:  # pragma: no cover - dev machine
    raise SystemExit(
        "picamera2 not available. Install with `sudo apt install -y python3-picamera2` "
        "on the Pi (it's not pip-installable on macOS)."
    ) from exc


# ---------- streaming output ---------------------------------------------------

class StreamingOutput(io.BufferedIOBase):
    """Latest-frame buffer the MJPEG encoder writes into."""

    def __init__(self) -> None:
        self.frame: Optional[bytes] = None
        self.condition = threading.Condition()

    def write(self, buf: bytes) -> int:  # type: ignore[override]
        with self.condition:
            self.frame = bytes(buf)
            self.condition.notify_all()
        return len(buf)


# ---------- camera setup ------------------------------------------------------

STREAM_W = int(os.environ.get("PHOTOBOOTH_WIDTH", "1280"))
STREAM_H = int(os.environ.get("PHOTOBOOTH_HEIGHT", "720"))
STILL_W = int(os.environ.get("PHOTOBOOTH_STILL_W", "2304"))
STILL_H = int(os.environ.get("PHOTOBOOTH_STILL_H", "1296"))
PRINTER = os.environ.get("PHOTOBOOTH_PRINTER")
REMOVE_BG = os.environ.get("PHOTOBOOTH_REMOVE_BG", "1") not in ("0", "false", "False", "")
REMBG_MODEL = os.environ.get("PHOTOBOOTH_REMBG_MODEL", "u2netp")
# escpos = direct USB ESC/POS (default, what every POS system uses).
# cups   = the old `lp` subprocess path. Only useful as a fallback.
PRINT_METHOD = os.environ.get("PHOTOBOOTH_PRINT_METHOD", "escpos")
PRINTER_VID = int(os.environ.get("PHOTOBOOTH_PRINTER_VID", "0x6868"), 16)
PRINTER_PID = int(os.environ.get("PHOTOBOOTH_PRINTER_PID", "0x0200"), 16)
PRINTER_FEED_LINES = int(os.environ.get("PHOTOBOOTH_PRINTER_FEED", "6"))
# Print head width in dots. Standard for 58mm thermals is 384 dots
# (203 DPI × 48mm). Bump to 576 for 80mm printers.
PRINTER_HEAD_DOTS = int(os.environ.get("PHOTOBOOTH_PRINTER_HEAD_DOTS", "384"))
# Font sizes (in pixels at 203 DPI). Tune these for receipt text size.
# 17 dots ≈ Font B native size; we render with TrueType so we can go
# smaller than that. Defaults aim for "compact" — bump up to taste.
BRAND_FONT_PX = int(os.environ.get("PHOTOBOOTH_BRAND_FONT_PX", "12"))
BODY_FONT_PX = int(os.environ.get("PHOTOBOOTH_BODY_FONT_PX", "11"))
# CUPS PageSize used for every print job. Default is the ZJ-58 PPD's
# longest predefined "continuous roll" entry — 48mm fixed width, up to
# 3276mm of feed. The printer only feeds enough paper for the actual
# image height; this just stops CUPS from fit-to-page'ing the tall
# canvas down into a fixed label size. Override via env var if your PPD
# uses different naming (e.g. `X58Y3276` or `Roll`).
PRINT_PAGESIZE = os.environ.get("PHOTOBOOTH_PAGESIZE", "X48Y3276")
# When set, every /print job writes a timestamped copy of the exact PNG
# we hand to `lp` here, so you can open it and confirm what the printer
# was asked to render. Defaults to ~/Desktop on the host running this
# server. Set PHOTOBOOTH_SAVE_DIR="" to disable, or to any path you'd
# rather use.
PRINT_SAVE_DIR = os.environ.get(
    "PHOTOBOOTH_SAVE_DIR", os.path.expanduser("~/Desktop")
)
# Physical paper width in millimeters (the actual roll, including the
# unprintable hardware margin on each side). Used to pad the page so
# the print head lands the printable content centered on the paper rather
# than flush against the left edge (which crops the leftmost ~5mm).
PAPER_WIDTH_MM = float(os.environ.get("PHOTOBOOTH_PAPER_WIDTH_MM", "58"))
# Whether to convert the incoming PNG to PDF before handing to lp. PDF
# carries page geometry inside the file, which CUPS's pdftoraster filter
# respects exactly — but only if cups-filters is installed (provides
# pdftoraster). Without that, lp passes raw PDF bytes through to the
# printer which interprets them as ESC/POS gibberish. Default off; flip
# to "1" once you've run `sudo apt install -y cups-filters`.
USE_PDF = os.environ.get("PHOTOBOOTH_USE_PDF", "0") == "1"


# ---------- background removal -----------------------------------------------
# rembg's session reuses a loaded ONNX model across calls. Loading is the
# expensive part (1–10s on a Pi); inference itself is ~0.5–3s per image
# depending on the chosen model. We lazy-create on first /capture so the
# server boots fast even if the model isn't downloaded yet.

_rembg_session = None
_rembg_lock = threading.Lock()
_rembg_status: dict = {"ready": False, "error": None}


def _get_rembg_session():
    global _rembg_session
    if _rembg_session is not None:
        return _rembg_session
    with _rembg_lock:
        if _rembg_session is None:
            from rembg import new_session  # imported lazily — heavy module
            _rembg_session = new_session(REMBG_MODEL)
            _rembg_status["ready"] = True
            _rembg_status["error"] = None
    return _rembg_session


def _strip_background(jpeg_bytes: bytes) -> bytes:
    """Run rembg on a JPEG and return a JPEG with the cutout flattened
    onto a pure white background (thermal-print friendly)."""
    from rembg import remove  # lazy import keeps cold-start fast
    cutout_png = remove(jpeg_bytes, session=_get_rembg_session())
    cutout = Image.open(io.BytesIO(cutout_png)).convert("RGBA")
    flat = Image.new("RGB", cutout.size, (255, 255, 255))
    flat.paste(cutout, mask=cutout.split()[3])
    out = io.BytesIO()
    flat.save(out, format="JPEG", quality=92)
    return out.getvalue()


def _warm_rembg() -> None:
    """Load the rembg model in a background thread so the first /capture
    after boot doesn't pay the 1–10s session-init cost. Errors are recorded
    on `_rembg_status` and surfaced via /health so install problems show up
    without having to take a photo first."""
    try:
        _get_rembg_session()
        print(f"[rembg] session ready (model={REMBG_MODEL})", flush=True)
    except Exception as exc:
        _rembg_status["ready"] = False
        _rembg_status["error"] = f"{type(exc).__name__}: {exc}"
        print(
            f"[rembg] FAILED to load (model={REMBG_MODEL}): {exc}\n"
            "        /capture will pass through the raw camera frame.",
            flush=True,
        )

picam2 = Picamera2()

# Single configuration with a small "main" preview stream and a larger "lores"
# isn't quite right for our case — we want a high-res still on demand. Instead
# we run the camera in video mode for streaming, then use `capture_array` /
# `capture_file` which gives us a still from the same configured sensor mode.
video_config = picam2.create_video_configuration(
    main={"size": (STREAM_W, STREAM_H), "format": "RGB888"},
)
picam2.configure(video_config)

stream_output = StreamingOutput()
picam2.start_recording(MJPEGEncoder(), FileOutput(stream_output))

# Lock so /capture and /stream don't trample each other.
camera_lock = threading.Lock()


# ---------- flask app ---------------------------------------------------------

app = Flask(__name__)
CORS(app)  # photobooth web app lives on a different origin (laptop dev / phone)


@app.route("/health")
def health():
    return jsonify(
        ok=True,
        printer=PRINTER or "system-default",
        stream=(STREAM_W, STREAM_H),
        still=(STILL_W, STILL_H),
        remove_bg=REMOVE_BG,
        rembg_model=REMBG_MODEL if REMOVE_BG else None,
        rembg_ready=_rembg_status["ready"] if REMOVE_BG else None,
        rembg_error=_rembg_status["error"] if REMOVE_BG else None,
    )


def _mjpeg_generator():
    boundary = b"--frame"
    while True:
        with stream_output.condition:
            stream_output.condition.wait()
            frame = stream_output.frame
        if frame is None:
            continue
        yield (
            boundary
            + b"\r\nContent-Type: image/jpeg\r\nContent-Length: "
            + str(len(frame)).encode()
            + b"\r\n\r\n"
            + frame
            + b"\r\n"
        )


@app.route("/stream")
def stream():
    return Response(
        _mjpeg_generator(),
        mimetype="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache, private", "Pragma": "no-cache"},
    )


@app.route("/capture")
def capture():
    """Capture a single still and return the JPEG bytes inline.

    If `PHOTOBOOTH_REMOVE_BG=1` (the default), the image is run through rembg
    and the cutout is flattened onto pure white before being returned. The
    browser sees a normal JPEG either way — only the pixels differ.
    """
    with camera_lock:
        # capture_file with BytesIO gives us a JPEG without round-tripping disk.
        buf = io.BytesIO()
        picam2.capture_file(buf, format="jpeg")
        data = buf.getvalue()

    if REMOVE_BG:
        t0 = time.monotonic()
        try:
            data = _strip_background(data)
            print(
                f"[capture] bg removed in {time.monotonic() - t0:.2f}s",
                flush=True,
            )
        except Exception as exc:  # pragma: no cover — fail-soft
            _rembg_status["ready"] = False
            _rembg_status["error"] = f"{type(exc).__name__}: {exc}"
            print(
                f"[capture] bg removal FAILED ({exc}) — sending raw frame",
                flush=True,
            )

    return Response(
        data,
        mimetype="image/jpeg",
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": f'inline; filename="capture-{int(time.time())}.jpg"',
        },
    )


# ---------- bitmap text rendering --------------------------------------------
# Below the printer's native Font B size we have to render text ourselves as
# a 1-bit bitmap and send it via the same image command the photo uses.

_FONT_CACHE: dict[int, ImageFont.FreeTypeFont] = {}


def _load_mono_font(size: int) -> ImageFont.FreeTypeFont:
    """Find a system monospace TrueType font and load it at the requested
    pixel size. Cached per-size so we don't reopen the .ttf on every print."""
    if size in _FONT_CACHE:
        return _FONT_CACHE[size]
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
        "/usr/share/fonts/truetype/freefont/FreeMono.ttf",
        "/Library/Fonts/Menlo.ttc",  # macOS dev fallback
        "/System/Library/Fonts/Menlo.ttc",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                font = ImageFont.truetype(path, size)
                _FONT_CACHE[size] = font
                return font
            except Exception:
                continue
    return ImageFont.load_default()  # tiny built-in bitmap font


def _render_lines_to_bitmap(
    lines: list,
    width_dots: int,
    font_size: int,
    align: str = "left",
) -> Image.Image:
    """Render a list of receipt rows as a 1-bit bitmap (black on white).

    Each item:
      - str             — single full-width line
      - [label, value]  — two-column row (label flush left, value flush right)
      - None            — half-height blank-line spacer

    Everything is lowercased at render time. align controls plain string
    alignment ("left" | "center"); two-column rows always do label-left,
    value-right.
    """
    font = _load_mono_font(font_size)
    bbox = font.getbbox("Mg")
    line_h = bbox[3] - bbox[1] + max(2, font_size // 4)

    total_h = 0
    for line in lines:
        if line is None:
            total_h += line_h // 2
        else:
            total_h += line_h
    total_h = max(total_h, line_h)

    img = Image.new("L", (width_dots, total_h), 255)
    draw = ImageDraw.Draw(img)
    # Disable PIL's text anti-aliasing — we render to a 1-bit thermal head
    # and AA fringes look like dot noise once thresholded.
    draw.fontmode = "1"

    y = 0
    for line in lines:
        if line is None:
            y += line_h // 2
            continue
        if isinstance(line, (list, tuple)) and len(line) == 2:
            label = str(line[0]).lower()
            value = str(line[1]).lower()
            draw.text((0, y), label, fill=0, font=font)
            vbox = draw.textbbox((0, 0), value, font=font)
            value_w = vbox[2] - vbox[0]
            draw.text((width_dots - value_w, y), value, fill=0, font=font)
        else:
            text = str(line).lower()
            if align == "center":
                tbox = draw.textbbox((0, 0), text, font=font)
                tw = tbox[2] - tbox[0]
                draw.text(((width_dots - tw) // 2, y), text, fill=0, font=font)
            else:
                draw.text((0, y), text, fill=0, font=font)
        y += line_h

    return img.convert("1", dither=Image.NONE)


def _prep_photo_for_thermal(img: Image.Image) -> Image.Image:
    """Convert a captured photo into a 1-bit bitmap that prints cleanly on
    thermal paper: grayscale, autocontrast for punch, gamma-lift mid-tones
    so dark areas don't crush to solid black, then Floyd–Steinberg dither
    to 1-bit. Resized to the print head's exact dot count (no driver-side
    scaling). All the heavy lifting that used to live in receiptCanvas.ts
    on the browser, done server-side now."""
    if img.mode != "L":
        img = img.convert("L")
    img = ImageOps.autocontrast(img, cutoff=2)
    # Gamma curve (mid-tone lift) — same idea as the old photoGamma knob
    # in photoboothConfig. 1.5 is a moderate one-stop lift.
    lut = [int(255 * ((i / 255) ** (1 / 1.5))) for i in range(256)]
    img = img.point(lut)
    # Resize to exactly the print head width before dithering so the
    # 1-bit pattern lands on real printer pixels.
    if img.width != PRINTER_HEAD_DOTS:
        ratio = PRINTER_HEAD_DOTS / img.width
        new_h = max(1, int(round(img.height * ratio)))
        img = img.resize((PRINTER_HEAD_DOTS, new_h), Image.LANCZOS)
    return img.convert("1", dither=Image.FLOYDSTEINBERG)


def _print_receipt_escpos(
    photo: Optional[Image.Image],
    brand: str,
    lines: list,
    feed_lines: int,
) -> None:
    """Compose and emit the receipt using native ESC/POS commands.

    Each section is a real printer instruction, not a rasterized bitmap:
      - brand wordmark uses the printer's built-in font at 2x size
      - photo is the only bitmap (sized to the head width, dithered)
      - body rows print as native text with monospace column alignment
      - line feeds and final paper feed are explicit \n bytes

    Result is sub-second printing with the printer's own crisp font and
    perfect alignment, with zero CUPS/driver involvement.
    """
    from escpos.printer import Usb

    printer = Usb(PRINTER_VID, PRINTER_PID, profile="default")
    try:
        # Brand wordmark — rendered as a small bitmap so we can use any
        # font size below the printer's native Font B floor. No bold,
        # lowercased, left-aligned to match the body block below.
        brand_img = _render_lines_to_bitmap(
            [brand],
            width_dots=PRINTER_HEAD_DOTS,
            font_size=BRAND_FONT_PX,
            align="left",
        )
        printer.image(brand_img, impl="bitImageRaster")
        printer._raw(b"\n")

        # Photo (the only "real" bitmap — already prepped: grayscale,
        # gamma-lifted, dithered, sized to the print head).
        if photo is not None:
            printer.image(photo, impl="bitImageRaster")
        printer._raw(b"\n")

        # Body — assemble the full row list (config lines + auto-added
        # DATE + TICKET) and render as a single bitmap. Every string is
        # lowercased inside the render helper.
        body_rows: list = list(lines)
        body_rows.append(None)
        date_str = time.strftime("%Y-%m-%d %H:%M") + " UTC"
        ticket_str = f"#{random.randint(1000, 9999)}"
        body_rows.append(["DATE", date_str])
        body_rows.append(["TICKET", ticket_str])

        body_img = _render_lines_to_bitmap(
            body_rows,
            width_dots=PRINTER_HEAD_DOTS,
            font_size=BODY_FONT_PX,
            align="left",
        )
        printer.image(body_img, impl="bitImageRaster")

        # Feed past the tear bar.
        for _ in range(feed_lines):
            printer._raw(b"\n")
    finally:
        try:
            printer.close()
        except Exception:
            pass


def _print_via_cups(
    data: bytes,
    suffix: str,
    img_meta: Optional[Image.Image],
    img_w: int,
    img_h: int,
    w_mm: Optional[float],
    h_mm: Optional[float],
) -> tuple[bool, str]:
    """Old CUPS `lp` path — kept as a fallback. Returns (ok, message)."""
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as fh:
        fh.write(data)
        path = fh.name

    cmd = ["lp"]
    if PRINTER:
        cmd += ["-d", PRINTER]
    if w_mm and h_mm:
        cmd += [
            "-o", f"PageSize=Custom.{w_mm:g}x{h_mm:g}mm",
            "-o", f"media=Custom.{w_mm:g}x{h_mm:g}mm",
        ]
    else:
        cmd += ["-o", f"PageSize={PRINT_PAGESIZE}"]
    cmd += [
        "-o", "ppi=203",
        "-o", "natural-scaling=100",
        "-o", "fitplot=false",
        path,
    ]
    print(f"[print] (cups) {' '.join(cmd)}", flush=True)
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired:
        return False, "lp timed out"
    if result.returncode != 0:
        return False, result.stderr.strip() or "lp failed"
    return True, result.stdout.strip()


@app.route("/print", methods=["POST"])
def print_image():
    """Compose a thermal receipt and print it via direct ESC/POS.

    Two request shapes accepted:

      multipart/form-data (preferred, the new path):
        - photo:   image/jpeg|png  — the captured photo
        - brand:   string           — wordmark text
        - lines:   JSON string      — array of strings, [label,value], null
        - feed_lines: int           — blank line feeds at end (tear margin)

      raw bytes (legacy, the canvas-bitmap path):
        - body is image bytes; we just print them as a single bitmap.

    The new path renders text using the printer's built-in font (crisp,
    fast, perfect alignment) and uses the photo as the only bitmap. The
    legacy path is kept so a browser still sending a composed canvas
    PNG continues to work.
    """
    photo_img: Optional[Image.Image] = None
    brand = "groupdynamics.net"
    lines: list = []
    feed_lines = PRINTER_FEED_LINES

    if "photo" in request.files:
        # New native path.
        try:
            photo_img = Image.open(request.files["photo"].stream)
            photo_img = _prep_photo_for_thermal(photo_img)
        except Exception as exc:
            return jsonify(ok=False, error=f"photo decode failed: {exc}"), 400
        brand = request.form.get("brand", brand).strip() or brand
        try:
            lines = json.loads(request.form.get("lines", "[]"))
        except Exception:
            lines = []
        try:
            feed_lines = int(request.form.get("feed_lines", PRINTER_FEED_LINES))
        except ValueError:
            feed_lines = PRINTER_FEED_LINES

        print(
            f"[print] native ESC/POS — brand={brand!r}, "
            f"{len(lines)} body lines, photo={photo_img.size}",
            flush=True,
        )

        if PRINT_SAVE_DIR and photo_img is not None:
            try:
                os.makedirs(PRINT_SAVE_DIR, exist_ok=True)
                ts = time.strftime("%Y%m%d-%H%M%S")
                photo_img.save(os.path.join(PRINT_SAVE_DIR, f"receipt-{ts}-photo.png"))
                with open(os.path.join(PRINT_SAVE_DIR, f"receipt-{ts}-meta.txt"), "w") as fh:
                    fh.write(f"brand: {brand}\nlines:\n")
                    for ln in lines:
                        fh.write(f"  {ln}\n")
                    fh.write(f"feed_lines: {feed_lines}\n")
            except Exception as exc:
                print(f"[print] could not save mirror: {exc}", flush=True)

        try:
            _print_receipt_escpos(photo_img, brand, lines, feed_lines)
            print("[print] done", flush=True)
            return jsonify(ok=True, method="escpos-native")
        except Exception as exc:
            print(f"[print] FAILED: {exc}", flush=True)
            return jsonify(ok=False, method="escpos-native", error=str(exc)), 500

    # Legacy path: raw image bytes, print as single bitmap.
    data = request.get_data()
    if not data:
        return jsonify(ok=False, error="empty body — expected multipart photo"), 400
    try:
        img = Image.open(io.BytesIO(data))
        if img.mode in ("RGBA", "LA"):
            flat = Image.new("RGB", img.size, (255, 255, 255))
            flat.paste(img, mask=img.split()[-1])
            img = flat
        photo = _prep_photo_for_thermal(img)
    except Exception as exc:
        return jsonify(ok=False, error=f"image decode failed: {exc}"), 400
    try:
        from escpos.printer import Usb
        printer = Usb(PRINTER_VID, PRINTER_PID, profile="default")
        try:
            printer.image(photo, impl="bitImageRaster")
            for _ in range(PRINTER_FEED_LINES):
                printer._raw(b"\n")
        finally:
            try:
                printer.close()
            except Exception:
                pass
        return jsonify(ok=True, method="escpos-bitmap")
    except Exception as exc:
        return jsonify(ok=False, method="escpos-bitmap", error=str(exc)), 500


# ---------- entrypoint --------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PHOTOBOOTH_PORT", "8000"))
    # Warm rembg in the background so a missing model / broken install
    # surfaces in the logs immediately, not after the first photo is taken.
    if REMOVE_BG:
        threading.Thread(target=_warm_rembg, daemon=True).start()
    # threaded=True so /stream (long-lived) doesn't block /capture & /print.
    app.run(host="0.0.0.0", port=port, threaded=True, debug=False)
