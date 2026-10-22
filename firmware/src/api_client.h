#pragma once

#include <stddef.h>

/** GET {API_URL}/api/dashboard with the device token over HTTPS (certificate bundle, no setInsecure).
 *  Writes the body into `buf` (NUL-terminated). Returns the HTTP status, or a negative value on network errors. */
int api_fetch_dashboard(char *buf, size_t size);
