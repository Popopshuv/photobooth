# photobooth server

Tiny Flask app that runs on the Raspberry Pi and exposes the CSI camera +
attached printer to the photobooth web app over HTTP.

## What it gives you

| Endpoint        | What it does                                                          |
| --------------- | --------------------------------------------------------------------- |
| `GET /health`   | Sanity check — returns config and current printer.                    |
| `GET /stream`   | Multipart MJPEG stream. Drop straight into `<img src="…/stream">`.    |
| `GET /capture`  | A single JPEG still, taken right now.                                 |
| `POST /print`   | Body = image bytes (`image/png` or `image/jpeg`). Sends to CUPS.      |

## One-time Pi setup

```bash
# Camera stack (apt only — picamera2 is NOT on PyPI)
sudo apt update
sudo apt install -y python3-picamera2 python3-libcamera python3-pip cups

# Add yourself to the `lp` group so `lp` works without sudo
sudo usermod -a -G lp $USER

# Plug the printer in, then in a browser hit http://<pi-ip>:631
# (CUPS web UI) to add it. Confirm with:
lpstat -p
lp /etc/hostname        # smoke test — should print one page

# Make this printer the system default so the server can stay generic
# (no PHOTOBOOTH_PRINTER env var needed). Replace QUEUE_NAME with the
# name shown by `lpstat -p` (e.g. ZJ-58, POS58, etc):
sudo lpadmin -d QUEUE_NAME
lpstat -d                # should print "system default destination: QUEUE_NAME"
```

> Once a CUPS default is set the systemd unit's `Environment=PHOTOBOOTH_PRINTER=…`
> line is unnecessary — `lp` (no `-d`) routes to the default queue.

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
