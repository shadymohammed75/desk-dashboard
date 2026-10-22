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

/* Backlight off at night (minutes after midnight, local). This board's backlight is on/off only
 * (CH422G expander switch, per Waveshare's board config) — it can't dim. */
#define BACKLIGHT_OFF_FROM_MIN  (23 * 60)
#define BACKLIGHT_ON_FROM_MIN   (6 * 60 + 30)
