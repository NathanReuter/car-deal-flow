#!/usr/bin/env python3
"""curl_cffi sidecar for the Webmotors spend test (webmotors-spend-test.ts).

Reads a handoff JSON (cookies + UA + API URLs minted by a real browser), replays
each URL over curl_cffi with a browser-parity TLS/H2 fingerprint, and prints the
RAW responses as JSON to stdout. It deliberately does NOT decide "blocked?" —
the Node caller classifies with the same classifyWmApiResponse the live harvester
fails closed on, so both the in-browser control and this path use one rule.

Why chrome136: curl_cffi's newest Chrome target (136) matches Playwright's
bundled Chromium (v149) on JA4 + HTTP/2 exactly; chrome131 does not. Verified
against tls.peet.ws on 2026-07-23.

Setup (one-time, throwaway venv is fine):
    python3 -m venv .venv-curlcffi && ./.venv-curlcffi/bin/pip install curl_cffi
    # then pass --python ./.venv-curlcffi/bin/python to webmotors-spend-test.ts

Usage (normally invoked by the Node script, not by hand):
    python3 scripts/ingestion/webmotors_spend.py <handoff.json>
"""
import json
import sys
import time

IMPERSONATE = "chrome136"


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: webmotors_spend.py <handoff.json>", file=sys.stderr)
        return 2
    try:
        from curl_cffi import requests
    except ImportError:
        print(
            "curl_cffi not installed. Run: python3 -m venv .venv-curlcffi && "
            "./.venv-curlcffi/bin/pip install curl_cffi",
            file=sys.stderr,
        )
        return 3

    with open(sys.argv[1], encoding="utf-8") as fh:
        handoff = json.load(fh)

    cookies = {c["name"]: c["value"] for c in handoff.get("cookies", [])}
    headers = {
        "Accept": "application/json",
        "User-Agent": handoff["userAgent"],
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        "Referer": handoff["referer"],
        "Origin": handoff["origin"],
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
    }

    results = []
    session = requests.Session(impersonate=IMPERSONATE)
    for i, url in enumerate(handoff["apiUrls"]):
        try:
            resp = session.get(url, headers=headers, cookies=cookies, timeout=30)
            results.append(
                {
                    "url": url,
                    "ok": resp.ok,
                    "status": resp.status_code,
                    "contentType": resp.headers.get("content-type", ""),
                    "body": resp.text,
                }
            )
        except Exception as exc:  # noqa: BLE001 - report, don't crash the run
            results.append({"url": url, "error": str(exc)})
        if i < len(handoff["apiUrls"]) - 1:
            time.sleep(2)  # gentle pacing between pages

    json.dump({"impersonate": IMPERSONATE, "responses": results}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
