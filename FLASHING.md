# Flashing the desk screen

Board: **Waveshare ESP32-S3-LCD-4.3** (non-touch). You need Chrome or Edge on a computer, plus a USB-C cable that carries data. Nothing to install.

## One-time: GitHub secrets [ME]

The firmware gets your Wi-Fi and token at build time from GitHub Actions secrets. They are never committed.

1. On GitHub, open the **desk-dashboard** repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Add these four secrets, one at a time:

   | Name | Value |
   |---|---|
   | `WIFI_SSID` | your Wi-Fi name (2.4 GHz; the ESP32-S3 has no 5 GHz) |
   | `WIFI_PASS` | your Wi-Fi password |
   | `API_URL` | your Worker address, e.g. `https://desk-dashboard.<you>.workers.dev` (no `/` at the end) |
   | `DEVICE_TOKEN` | exactly the same value as the Worker's `DEVICE_TOKEN` secret in Cloudflare |

3. Go to **Actions** → **firmware** → **Run workflow** (or push any change under `firmware/`). Wait for the green check, about 5 minutes the first time.

If a secret is missing, the build still runs, but the artifact is named **firmware-PLACEHOLDER-not-flashable**. Don't flash that one.

## Flash

1. **Download.** In the repo, go to **Actions** → the newest green **firmware** run → **Artifacts** → **firmware**. Unzip it to get `firmware-merged.bin`.
2. **Open the flasher.** In Chrome or Edge, open `https://desk-dashboard.<you>.workers.dev/flash/`.
3. **Choose the file.** Click **Choose firmware-merged.bin…** and pick the file. The page says "Ready".
4. **Connect.** Plug the board into the computer using the USB-C port marked **UART**.
   - The first time, if no port shows up: hold **BOOT**, plug in, then release.
5. **Install.** Click **Connect & install**, pick the port (usually "USB Single Serial" or "CH343"), then **Install**.
   - On the very first install, answer **Erase** = yes.
6. **Watch the log.** When it finishes, click **Logs & console**. You should see:
   ```
   [boot] Desk Health Dashboard
   [wifi] connected, ip 192.168.x.x
   [api] GET /api/dashboard -> 200 (… bytes)
   [ui] score 63, gym 0, mode 2
   ```

## First check the board with Waveshare's demo (Phase 6, step 1)

Waveshare ships a ready image: `firmware/lvgl_Porting_No_Touch.bin` in the GitHub repo **waveshareteam/ESP32-S3-Touch-LCD-4.3**. Use **Download raw file**.

It is a full image like ours, so use the same page: choose that file and click **Install**. If its demo appears, the screen and cable are fine.

## When something is wrong

| Log says | Fix |
|---|---|
| `[api] … -> 401` | `DEVICE_TOKEN` in GitHub doesn't match the one in Cloudflare. Fix it, re-run the workflow, reflash. |
| `[wifi] down, reconnecting` forever | Wrong `WIFI_SSID`/`WIFI_PASS`, or the network is 5 GHz only. |
| `[api] … -> -1` or `-2` | Wrong `API_URL`, or the Worker isn't deployed yet. |
| No port in the browser | Use a data cable (not charge-only), try the other USB-C port, or hold BOOT while plugging in. |
| Screen stays dark at night | Expected. The backlight is off from 23:00 to 06:30 (`firmware/include/config.h`). |

## Updating later

Push a change and wait for the green **firmware** run, then repeat **Flash** (no erase needed). Wireless OTA updates are a later improvement (PLAN.md, Phase 6, step 6).
