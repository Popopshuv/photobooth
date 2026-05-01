"""Photobooth server — runs on the Raspberry Pi.

Exposes the CSI camera (Freenove / Pi camera via libcamera/picamera2) and the
USB-connected printer (via CUPS `lp`) over a small HTTP API the Next.js app
talks to from the browser:

  GET  /health    -> {"ok": true, ...}
  GET  /stream    -> multipart MJPEG stream (drop into <img src=...>)
  GET  /capture   -> single JPEG still (Content-Type: image/jpeg)
  POST /print     -> body: image/png|image/jpeg, sends to CUPS printer

Run:
    python3 app.py            # binds 0.0.0.0:8000

Env:
    PHOTOBOOTH_PORT       default 8000
    PHOTOBOOTH_PRINTER    CUPS printer name (lpstat -p). If unset, /print
                          uses the system default printer.
    PHOTOBOOTH_WIDTH      stream width  (default 1280)
    PHOTOBOOTH_HEIGHT     stream height (default 720)
    PHOTOBOOTH_STILL_W    still width   (default 2304)
    PHOTOBOOTH_STILL_H    still height  (default 1296)
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
    """Capture a single still and return the JPEG bytes inline."""
    with camera_lock:
        # capture_file with BytesIO gives us a JPEG without round-tripping disk.
        buf = io.BytesIO()
        picam2.capture_file(buf, format="jpeg")
        data = buf.getvalue()
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

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as fh:
        fh.write(data)
        path = fh.name

    cmd = ["lp"]
    if PRINTER:
        cmd += ["-d", PRINTER]
    # `fit-to-page` so the receipt scales to the printable area regardless of
    # what stock is loaded. Adjust per your printer if needed.
    cmd += ["-o", "fit-to-page", path]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired:
        return jsonify(ok=False, error="lp timed out"), 504

    if result.returncode != 0:
        return (
            jsonify(ok=False, error=result.stderr.strip() or "lp failed", cmd=" ".join(cmd)),
            500,
        )

    return jsonify(ok=True, job=result.stdout.strip(), file=path)


# ---------- entrypoint --------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PHOTOBOOTH_PORT", "8000"))
    # threaded=True so /stream (long-lived) doesn't block /capture & /print.
    app.run(host="0.0.0.0", port=port, threaded=True, debug=False)
