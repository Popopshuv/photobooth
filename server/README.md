# photobooth server

Tiny Flask app that runs on the Raspberry Pi and exposes the CSI camera +
attached printer to the photobooth web app over HTTP.

## What it gives you

| Endpoint        | What it does                                                          |
| --------------- | --------------------------------------------------------------------- |
| `GET /health`   | Sanity check — returns config and current printer.                    |
| `GET /stream`   | Multipart MJPEG stream. Drop straight into `<img src="…/stream">`.    |
| `GET /capture`  | A single JPEG still — background removed (rembg) and flattened white. |
| `POST /print`   | Body = image bytes. Default path: ESC/POS direct over USB.            |

## How printing works

The default `POST /print` path **does not use CUPS**. It opens the thermal
printer as a USB device via `python-escpos` and sends ESC/POS raster
bitmap commands directly — same protocol every retail POS system uses.
This sidesteps every CUPS/driver quirk we used to fight (fit-to-page,
fit-to-page-into-a-label-size, missing pdftoraster, RGBA-as-black, etc).

CUPS remains as a fallback. Switch with `PHOTOBOOTH_PRINT_METHOD=cups`
if direct USB doesn't work for some reason.

## One-time Pi setup

```bash
# Camera stack (apt only — picamera2 is NOT on PyPI)
sudo apt update
sudo apt install -y python3-picamera2 python3-libcamera python3-pip \
                    libusb-1.0-0 cups

# Find your thermal printer's USB IDs:
lsusb
# Look for your printer in the list — line looks like:
#   Bus 001 Device 003: ID 0fe6:811e Kingsing
# Copy the "0fe6:811e" part — first half is VID, second half is PID.

# Allow non-root access to the printer's USB device. Replace 0fe6/811e
# with YOUR ids from lsusb:
echo 'SUBSYSTEM=="usb", ATTRS{idVendor}=="0fe6", ATTRS{idProduct}=="811e", MODE="0666"' | \
    sudo tee /etc/udev/rules.d/99-thermal-printer.rules
sudo udevadm control --reload-rules
sudo udevadm trigger
# Unplug + replug the printer to apply the new permissions.

# Tell the server about the IDs (or set them in the systemd unit):
export PHOTOBOOTH_PRINTER_VID=0x0fe6
export PHOTOBOOTH_PRINTER_PID=0x811e
```

> The CUPS setup below is **only needed if you want the CUPS fallback**.
> The default path doesn't touch CUPS at all.

```bash
# (Optional, for CUPS fallback only)
sudo apt install -y cups cups-filters
sudo usermod -a -G lp $USER
# Plug the printer in, then in a browser hit http://<pi-ip>:631
# (CUPS web UI) to add it. Confirm with:
lpstat -p
sudo lpadmin -d QUEUE_NAME      # set system default
```

## Run the server

The picamera2 install lives in the system Python, so use a venv that can see
system packages:

```bash
cd server
python3 -m venv --system-site-packages .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

You should see Flask listening on `0.0.0.0:8000`. From your laptop:

```bash
curl http://raspberrypi.local:8000/health
open http://raspberrypi.local:8000/stream   # macOS preview
```

## Config (env vars)

| Var                  | Default            | Notes                                       |
| -------------------- | ------------------ | ------------------------------------------- |
| `PHOTOBOOTH_PORT`    | `8000`             |                                             |
| `PHOTOBOOTH_PRINTER` | system default     | `lpstat -p` to list. Pass the queue name.   |
| `PHOTOBOOTH_WIDTH`   | `1280`             | Live-stream width                           |
| `PHOTOBOOTH_HEIGHT`  | `720`              | Live-stream height                          |
| `PHOTOBOOTH_STILL_W` | `2304`             | Still-capture width                         |
| `PHOTOBOOTH_STILL_H` | `1296`             | Still-capture height                        |
| `PHOTOBOOTH_REMOVE_BG` | `1`              | `0` to disable rembg (raw JPEG out of /capture) |
| `PHOTOBOOTH_REMBG_MODEL` | `u2netp`       | `u2net`/`isnet-general-use`/`silueta` for higher quality, slower |

## Background removal

`/capture` runs the still through [rembg](https://github.com/danielgatis/rembg)
and flattens the cutout onto white before returning the JPEG. This makes
1-bit thermal prints look much cleaner — random outdoor noise becomes a
dither nightmare on receipt paper, but a clean white field stays clean.

First-time setup:

```bash
# rembg downloads its ONNX model on first call (~5–180MB depending on the
# model). Pre-warm it so the first /capture isn't a 30-second wait:
source .venv/bin/activate
python -c "from rembg import new_session; new_session('u2netp')"
```

To disable (e.g. while debugging the camera): `PHOTOBOOTH_REMOVE_BG=0 python app.py`.

## Run on boot

Drop a systemd unit at `/etc/systemd/system/photobooth.service`:

```ini
[Unit]
Description=Photobooth camera + print server
After=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/photobooth/server
# PHOTOBOOTH_PRINTER is only needed if you didn't run `sudo lpadmin -d`
# above — otherwise `lp` uses the CUPS system default.
ExecStart=/home/pi/photobooth/server/.venv/bin/python app.py
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now photobooth
sudo systemctl status photobooth
journalctl -fu photobooth     # tail logs
```

## Tell the web app where the Pi is

In the photobooth Next.js app set:

```bash
# .env.local at the repo root
NEXT_PUBLIC_PI_URL=http://raspberrypi.local:8000
```

(or the Pi's LAN IP if mDNS doesn't resolve).
