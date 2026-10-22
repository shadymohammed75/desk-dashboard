// Desk Health Dashboard firmware. The server does all the thinking; this fetches /api/dashboard and draws it.
//
// Core 1 (Arduino loop): LVGL only — timers, ui_update, clock, backlight schedule.
// Core 0 (net task):     Wi-Fi, NTP and HTTPS fetches; hands JSON to the loop through a mutex-guarded buffer.
#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_display_panel.hpp>
#include <esp_task_wdt.h>
#include <lvgl.h>
#include <time.h>

#include "api_client.h"
#include "config.h"
#include "dashboard_data.h"
#include "ui.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Missing include/secrets.h — copy include/secrets.h.example (CI writes it from GitHub Actions secrets)."
#endif

using namespace esp_panel::board;
using namespace esp_panel::drivers;

static Board *board;
static LCD *lcd;
static Preferences prefs;

// ---------------------------------------------------------------- net task → loop handoff

static SemaphoreHandle_t json_lock;
static char json_buf[8192];
static char net_buf[8192];
static volatile bool json_fresh;
static volatile bool fetch_failed;
static volatile bool fetch_now = true;

static void net_task(void *)
{
    esp_task_wdt_add(nullptr);
    uint32_t next = 0, wifi_down_since = 0;
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.persistent(false);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    configTzTime(TZ_BERLIN, NTP_1, NTP_2);

    for(;;) {
        esp_task_wdt_reset();
        uint32_t now = millis();
        if(WiFi.status() != WL_CONNECTED) {
            if(!wifi_down_since) {
                wifi_down_since = now ? now : 1;
                Serial.println("[wifi] down, reconnecting");
            }
            if(now - wifi_down_since > WIFI_REBOOT_AFTER_MS) {
                Serial.println("[wifi] down for 30 min, rebooting");
                delay(100);
                ESP.restart();
            }
            fetch_failed = true;
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }
        if(wifi_down_since) {
            Serial.printf("[wifi] connected, ip %s\n", WiFi.localIP().toString().c_str());
            wifi_down_since = 0;
            fetch_now = true;
        }
        if(fetch_now || (int32_t)(now - next) >= 0) {
            fetch_now = false;
            int status = api_fetch_dashboard(net_buf, sizeof net_buf);
            Serial.printf("[api] GET /api/dashboard -> %d (%u bytes)\n", status, (unsigned)strlen(net_buf));
            if(status == 200) {
                xSemaphoreTake(json_lock, portMAX_DELAY);
                memcpy(json_buf, net_buf, sizeof json_buf);
                json_fresh = true;
                xSemaphoreGive(json_lock);
                fetch_failed = false;
                next = millis() + FETCH_INTERVAL_MS;
            }
            else {
                if(status == 401) Serial.println("[api] 401: DEVICE_TOKEN doesn't match the Worker's secret");
                fetch_failed = true;
                next = millis() + FETCH_RETRY_MS;
            }
        }
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}

// ---------------------------------------------------------------- celebration ids in NVS (each plays once)

static bool cel_seen(const char *id)
{
    String ids = prefs.getString("cel", "");
    return ids.indexOf(String(id) + "|") >= 0;
}

static void cel_mark(const char *id)
{
    String ids = prefs.getString("cel", "") + id + "|";
    while(ids.length() > 400) ids = ids.substring(ids.indexOf('|') + 1);   // keep the newest few
    prefs.putString("cel", ids);
}

// ---------------------------------------------------------------- LVGL glue

static void flush_cb(lv_display_t *disp, const lv_area_t *a, uint8_t *px)
{
    lcd->drawBitmap(a->x1, a->y1, lv_area_get_width(a), lv_area_get_height(a), px);
    lv_display_flush_ready(disp);
}

static uint32_t tick_cb(void) { return millis(); }

static lv_display_t *lvgl_start(void)
{
    lv_init();
    lv_tick_set_cb(tick_cb);
    lv_display_t *disp = lv_display_create(lcd->getFrameWidth(), lcd->getFrameHeight());
    // Two 40-line buffers in internal RAM: fast to render into, small enough to leave room for TLS.
    const size_t lines = 40, bytes = lcd->getFrameWidth() * lines * 2;
    void *b1 = heap_caps_malloc(bytes, MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA);
    void *b2 = heap_caps_malloc(bytes, MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA);
    lv_display_set_buffers(disp, b1, b2, bytes, LV_DISPLAY_RENDER_MODE_PARTIAL);
    lv_display_set_flush_cb(disp, flush_cb);
    return disp;
}

// ---------------------------------------------------------------- clock + backlight

static bool time_valid(struct tm *t)
{
    time_t now = time(nullptr);
    localtime_r(&now, t);
    return t->tm_year >= (2024 - 1900);
}

static void update_clock_and_backlight(void)
{
    static int last_min = -1;
    static int backlight = -1;
    struct tm t;
    if(!time_valid(&t) || t.tm_min == last_min) return;
    last_min = t.tm_min;

    static const char *wd[] = {"SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"};
    static const char *mo[] = {"JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"};
    char text[40];
    snprintf(text, sizeof text, "%s %d %s \xC2\xB7 %02d:%02d", wd[t.tm_wday], t.tm_mday, mo[t.tm_mon], t.tm_hour, t.tm_min);
    ui_set_clock(text);

    int m = t.tm_hour * 60 + t.tm_min;
    bool off = BACKLIGHT_OFF_FROM_MIN > BACKLIGHT_ON_FROM_MIN
                   ? (m >= BACKLIGHT_OFF_FROM_MIN || m < BACKLIGHT_ON_FROM_MIN)
                   : (m >= BACKLIGHT_OFF_FROM_MIN && m < BACKLIGHT_ON_FROM_MIN);
    if(backlight != !off && board->getBacklight()) {
        backlight = !off;
        if(off) board->getBacklight()->off();
        else board->getBacklight()->on();
        Serial.printf("[backlight] %s\n", off ? "off (night)" : "on");
    }
}

// ---------------------------------------------------------------- setup / loop

void setup()
{
    Serial.begin(115200);
    Serial.println("\n[boot] Desk Health Dashboard");

    esp_task_wdt_config_t wdt = {.timeout_ms = WATCHDOG_TIMEOUT_S * 1000, .idle_core_mask = 0, .trigger_panic = true};
    esp_task_wdt_reconfigure(&wdt);
    esp_task_wdt_add(nullptr);

    prefs.begin("desk", false);

    board = new Board();
    board->init();
    lcd = board->getLCD();
    lcd->configFrameBufferNumber(1);
    if(lcd->getBus()->getBasicAttributes().type == ESP_PANEL_BUS_TYPE_RGB) {
        static_cast<BusRGB *>(lcd->getBus())->configRGB_BounceBufferSize(lcd->getFrameWidth() * 10);   // avoids drift
    }
    if(!board->begin()) {
        Serial.println("[boot] board init failed");
    }
    if(board->getBacklight()) board->getBacklight()->on();

    lv_display_t *disp = lvgl_start();
    ui_set_celebration_store(cel_seen, cel_mark);
    ui_init(disp);
    ui_set_offline(true);
    lv_timer_handler();
    Serial.printf("[boot] PSRAM free %u, heap free %u\n", (unsigned)ESP.getFreePsram(), (unsigned)ESP.getFreeHeap());

    json_lock = xSemaphoreCreateMutex();
    xTaskCreatePinnedToCore(net_task, "net", 8192, nullptr, 1, nullptr, 0);
}

void loop()
{
    esp_task_wdt_reset();
    static bool was_failed = true;

    if(json_fresh) {
        static DashboardData d;   // ~1 KB, keep off the stack
        bool ok;
        xSemaphoreTake(json_lock, portMAX_DELAY);
        ok = dashboard_parse(json_buf, &d);
        json_fresh = false;
        xSemaphoreGive(json_lock);
        if(ok) {
            ui_update(&d);
            Serial.printf("[ui] score %d, gym %d, mode %d\n", (int)d.score, (int)d.gym, (int)d.mode);
        }
        else Serial.println("[ui] could not parse dashboard JSON");
    }
    if(fetch_failed != was_failed) {
        was_failed = fetch_failed;
        ui_set_offline(was_failed);   // keeps the last data on screen, marks it "offline"
    }
    update_clock_and_backlight();
    uint32_t wait = lv_timer_handler();
    delay(wait > 10 ? 10 : (wait ? wait : 1));
}
