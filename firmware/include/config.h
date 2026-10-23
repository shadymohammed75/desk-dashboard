/* Device behaviour that isn't secret. */
#pragma once

#define FETCH_INTERVAL_MS       (10UL * 60 * 1000)   /* /api/dashboard every 10 min */
#define FETCH_RETRY_MS          (60UL * 1000)        /* after a failure */
#define HTTP_TIMEOUT_MS         15000
#define WIFI_REBOOT_AFTER_MS    (30UL * 60 * 1000)   /* reboot if Wi-Fi is down this long */
#define WATCHDOG_TIMEOUT_S      60

#define TZ_BERLIN               "CET-1CEST,M3.5.0,M10.5.0/3"
#define NTP_1                   "pool.ntp.org"
#define NTP_2                   "time.cloudflare.com"

/* Optional backlight-off window (minutes after midnight, local); equal values = never off.
 * This board's backlight is on/off only (CH422G expander switch, per Waveshare's board config) — it
 * can't dim. So at night the screen stays lit and shows the near-black sleep scene instead (window
 * from the server config, 00:00–08:00 by default). Set e.g. (3 * 60) and (7 * 60) to go fully dark
 * for part of the night. */
#define BACKLIGHT_OFF_FROM_MIN  0
#define BACKLIGHT_ON_FROM_MIN   0
