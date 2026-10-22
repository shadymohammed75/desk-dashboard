#!/usr/bin/env python3
"""Write firmware/include/secrets.h from environment variables (GitHub Actions secrets).

Missing secrets fall back to placeholders so CI still proves the code compiles, but the script says so loudly
and writes `placeholder=true` to $GITHUB_OUTPUT so the workflow can label the artifact as not flashable.
Values are never printed.
"""
import os
from pathlib import Path

KEYS = ["WIFI_SSID", "WIFI_PASS", "API_URL", "DEVICE_TOKEN"]


def c_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def main() -> None:
    missing = [k for k in KEYS if not os.environ.get(k)]
    lines = ["/* Generated in CI from GitHub Actions secrets. Never commit this file. */", "#pragma once", ""]
    for k in KEYS:
        v = os.environ.get(k) or f"MISSING_{k}"
        if k == "API_URL":
            v = v.rstrip("/")
        lines.append(f"#define {k} {c_string(v)}")
    out = Path(__file__).resolve().parents[1] / "include" / "secrets.h"
    out.write_text("\n".join(lines) + "\n")
    if missing:
        print(f"::warning::Missing secrets {', '.join(missing)} — built with placeholders; this firmware can't connect.")
    else:
        print("secrets.h written from GitHub Actions secrets")
    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        with open(gh_out, "a") as f:
            f.write(f"placeholder={'true' if missing else 'false'}\n")


if __name__ == "__main__":
    main()
