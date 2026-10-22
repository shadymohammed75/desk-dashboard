// HTTPS client for /api/dashboard. Uses ESP-IDF's esp_http_client with the built-in Mozilla CA bundle,
// so the Worker's certificate is verified properly (never setInsecure()).
#include "api_client.h"

#include <esp_crt_bundle.h>
#include <esp_http_client.h>
#include <string.h>

#include "config.h"
#include "secrets.h"

int api_fetch_dashboard(char *buf, size_t size)
{
    esp_http_client_config_t cfg = {};
    cfg.url = API_URL "/api/dashboard";
    cfg.method = HTTP_METHOD_GET;
    cfg.timeout_ms = HTTP_TIMEOUT_MS;
    cfg.crt_bundle_attach = esp_crt_bundle_attach;
    cfg.buffer_size = 2048;
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if(!client) return -1;

    esp_http_client_set_header(client, "Authorization", "Bearer " DEVICE_TOKEN);
    esp_http_client_set_header(client, "Accept", "application/json");

    int status = -2;
    if(esp_http_client_open(client, 0) == ESP_OK) {
        esp_http_client_fetch_headers(client);
        status = esp_http_client_get_status_code(client);
        size_t len = 0;
        while(len + 1 < size) {
            int n = esp_http_client_read(client, buf + len, (int)(size - 1 - len));
            if(n <= 0) break;
            len += (size_t)n;
        }
        buf[len] = '\0';
        if(len + 1 >= size) status = -3;   /* body didn't fit */
    }
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    return status;
}
