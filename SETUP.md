# Setup: the steps only you can do

Everything that could be built in the cloud is built and tested. These are the clicks left, in order. Each takes a few minutes.

## 1. Merge the code into `main`

The work is on the branch `claude/build`. Cloudflare deploys from `main`.

1. Open https://github.com/shadymohammed75/desk-dashboard/compare/main...claude/build
2. Click **Create pull request**, then **Merge pull request**.

## 2. Make two tokens

Make two long random strings, at least 24 characters each. A password manager's "generate password" (40 characters, letters and digits) is perfect.

- **INGEST_TOKEN**: for the phone app and the Shortcut (read and write).
- **DEVICE_TOKEN**: for the desk screen (read-only).

Keep them in your password manager. Never paste them into GitHub issues or code.

## 3. Cloudflare (free account)

1. Go to dash.cloudflare.com → **Workers & Pages** → **Create** → **Import a repository** → connect GitHub → pick **desk-dashboard**.
2. Fill in:
   - **Project name:** `desk-dashboard` (must match `name` in `backend/wrangler.toml`)
   - **Production branch:** `main`
   - **Root directory / Path:** `backend`
   - **Build command:** leave empty
   - **Deploy command:** `npx wrangler deploy` (the default)
3. **Deploy.** The first deploy also creates the KV storage automatically.
4. Open the Worker → **Settings** → **Variables and Secrets** → **Add**. Set **Type** to **Secret** for both:
   - `INGEST_TOKEN` = your ingest token
   - `DEVICE_TOKEN` = your device token
5. Note your address: `https://desk-dashboard.<your-subdomain>.workers.dev`.

**Check:** open `https://desk-dashboard.<you>.workers.dev/api/health`. It should show `{"ok":true}`.

## 4. GitHub secrets (firmware build and live smoke test)

Go to the repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Add five:

| Name | Value |
|---|---|
| `API_URL` | `https://desk-dashboard.<you>.workers.dev` (no `/` at the end) |
| `INGEST_TOKEN` | same as in Cloudflare (used only by the smoke test) |
| `DEVICE_TOKEN` | same as in Cloudflare |
| `WIFI_SSID` | your 2.4 GHz Wi-Fi name |
| `WIFI_PASS` | your Wi-Fi password |

Then go to **Actions** → **smoke** → **Run workflow**. It checks the live Worker end to end and must end with **SMOKE PASSED**. It adds a sample sync and BP reading for today.

## 5. Phone app

1. On the iPhone, open `https://desk-dashboard.<you>.workers.dev/app` in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open **Gym Log** from the Home Screen and paste your **INGEST_TOKEN** once.
4. Go to the **Plan** tab and set your real schedule and goals. The defaults are placeholders.

## 6. Apple Health sync

Follow `shortcuts/README.md`: build one Shortcut and add three automations.

## 7. The screen (buy it last)

Waveshare **ESP32-S3-LCD-4.3** (non-touch), about €25–35, plus a USB-C cable that carries data. Then follow `FLASHING.md`:

1. Flash Waveshare's demo to check the board.
2. Run **Actions** → **firmware** → **Run workflow**.
3. Download the artifact and flash it from `https://desk-dashboard.<you>.workers.dev/flash/` in Chrome or Edge.
