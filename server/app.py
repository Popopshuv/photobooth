"""Photobooth server — runs on the Raspberry Pi.

Exposes the CSI camera (Freenove / Pi camera via libcamera/picamera2) and the
USB-connected printer (via CUPS `lp`) over a small HTTP API the Next.js app
talks to from the browser:

  GET  /health    -> {"ok": true, ...}
  GET  /stream    -> multipart MJPEG stream (drop into <img src=...>)
  GET  /capture   -> single JPEG still (Content-Type: image/jpeg)
                     Background is removed and composited onto white so the
                     thermal print looks clean — toggle with PHOTOBOOTH_REMOVE_BG.
  POST /print     -> body: image/png|image/jpeg, sends to CUPS printer

Run:
    python3 app.py            # binds 0.0.0.0:8000

Env:
    PHOTOBOOTH_PORT        default 8000
    PHOTOBOOTH_PRINTER     CUPS printer name (lpstat -p). If unset, /print
                           uses the system default printer.
    PHOTOBOOTH_WIDTH       stream width  (default 1280)
    PHOTOBOOTH_HEIGHT      stream height (default 720)
    PHOTOBOOTH_STILL_W     still width   (default 2304)
    PHOTOBOOTH_STILL_H     still height  (default 1296)
    PHOTOBOOTH_REMOVE_BG   "1"/"0" — run rembg on captures (default 1)
    PHOTOBOOTH_REMBG_MODEL rembg model name (default "u2netp" — small/fast).
                           Other good options: "u2net" (better quality, ~3x
                           slower), "isnet-general-use", "silueta".
"""

from __future__ import annotations

import io
import os
import subprocess
import tempfile
import threading
import time
from typing import Optional

from flask import Flask, Response, jsonify, request
from flask_cors import CORS
from PIL import Image

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


@app.route("/print", methods=["POST"])
def print_image():
    """Receive a composed image and send it to the local CUPS printer.

    Body: raw image bytes (image/png or image/jpeg). We do not parse multipart
    here — the client posts a Blob directly.
    """
    data = request.get_data()
    if not data:
        return jsonify(ok=False, error="empty body"), 400

    ctype = request.headers.get("Content-Type", "image/png")
    suffix = ".png" if "png" in ctype else ".jpg"

    # Two preprocessing steps before handing off to CUPS:
    #   1. Flatten any alpha channel onto white. Canvas-emitted PNGs are
    #      RGBA; some image viewers and CUPS image filters render
    #      transparent pixels as black, which makes a "fully opaque" canvas
    #      appear to be a black rectangle and produces broken prints.
    #   2. Stamp 203 DPI metadata so the CUPS image filter computes the
    #      bitmap's natural size against the printer's actual head
    #      resolution — without this, default 72 DPI math under-renders
    #      the image to roughly a quarter of the paper width.
    img_w = 0
    img_h = 0
    try:
        img_meta = Image.open(io.BytesIO(data))
        img_w, img_h = img_meta.size
        if img_meta.mode in ("RGBA", "LA"):
            flat = Image.new("RGB", img_meta.size, (255, 255, 255))
            flat.paste(img_meta, mask=img_meta.split()[-1])
            img_meta = flat
        elif img_meta.mode != "RGB":
            img_meta = img_meta.convert("RGB")
        stamped = io.BytesIO()
        img_meta.save(stamped, format="PNG", dpi=(203, 203))
        data = stamped.getvalue()
        # Force the on-disk filename to match what we actually wrote.
        suffix = ".png"
        ctype = "image/png"
        print(
            f"[print] received {img_w}x{img_h}px (flattened to RGB, "
            f"stamped 203dpi, {len(data)} bytes)",
            flush=True,
        )
    except Exception as exc:
        print(f"[print] could not preprocess image: {exc}", flush=True)

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as fh:
        fh.write(data)
        path = fh.name

    # Mirror the exact bytes we're about to hand `lp` to a human-readable
    # location so the dev can open it and verify the receipt is composed
    # correctly. Mirrors AFTER the DPI stamp above so the saved file is
    # byte-identical to what CUPS sees.
    if PRINT_SAVE_DIR:
        try:
            os.makedirs(PRINT_SAVE_DIR, exist_ok=True)
            ts = time.strftime("%Y%m%d-%H%M%S")
            mirror_path = os.path.join(PRINT_SAVE_DIR, f"receipt-{ts}{suffix}")
            with open(mirror_path, "wb") as fh:
                fh.write(data)
            print(f"[print] saved a copy to {mirror_path}", flush=True)
        except Exception as exc:
            print(f"[print] could not save copy: {exc}", flush=True)

    cmd = ["lp"]
    if PRINTER:
        cmd += ["-d", PRINTER]

    # Page rectangle = exactly the dimensions of our composed image, in
    # millimeters. Combined with `fitplot=false` and `ppi=203`, this gives
    # CUPS unambiguous instructions: page is W×H mm, the bitmap is at 203
    # DPI (which makes its natural size also W×H mm), so render it 1:1.
    # `PRINT_PAGESIZE` (env var, default `X48Y3276`) is only used if the
    # client doesn't supply per-job dimensions — it's the conservative
    # "infinite roll" fallback. We still send it as `media=` so CUPS sees
    # both the PageSize geometry and the media tag.
    w_mm = request.args.get("w_mm", type=float)
    h_mm = request.args.get("h_mm", type=float)
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

    print(f"[print] {' '.join(cmd)}", flush=True)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired:
        return jsonify(ok=False, error="lp timed out"), 504

    if result.returncode != 0:
        return (
            jsonify(ok=False, error=result.stderr.strip() or "lp failed", cmd=" ".join(cmd)),
            500,
        )

    return jsonify(ok=True, job=result.stdout.strip(), file=path, cmd=" ".join(cmd))


# ---------- entrypoint --------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PHOTOBOOTH_PORT", "8000"))
    # Warm rembg in the background so a missing model / broken install
    # surfaces in the logs immediately, not after the first photo is taken.
    if REMOVE_BG:
        threading.Thread(target=_warm_rembg, daemon=True).start()
    # threaded=True so /stream (long-lived) doesn't block /capture & /print.
    app.run(host="0.0.0.0", port=port, threaded=True, debug=False)
