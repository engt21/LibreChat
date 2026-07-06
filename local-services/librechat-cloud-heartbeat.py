#!/usr/bin/env python3
import json
import os
import socket
import time
import urllib.request
from datetime import datetime, timezone

instrumentation_key = os.environ["APPINSIGHTS_INSTRUMENTATION_KEY"]
ingestion_endpoint = os.environ.get("APPINSIGHTS_INGESTION_ENDPOINT", "https://dc.services.visualstudio.com").rstrip("/")
interval = int(os.environ.get("HEARTBEAT_INTERVAL_SECONDS", "60"))

while True:
    timestamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    payload = {
        "name": "Microsoft.ApplicationInsights.Event",
        "time": timestamp,
        "iKey": instrumentation_key,
        "tags": {
            "ai.cloud.role": "librechat-pve2-deadman",
            "ai.cloud.roleInstance": socket.gethostname(),
        },
        "data": {
            "baseType": "EventData",
            "baseData": {
                "ver": 2,
                "name": "librechat-pve2-heartbeat",
                "properties": {
                    "host": socket.gethostname(),
                    "source": "systemd-user-service",
                    "purpose": "external-deadman",
                },
                "measurements": {"alive": 1},
            },
        },
    }
    request = urllib.request.Request(
        f"{ingestion_endpoint}/v2/track",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            response.read()
    except Exception as error:
        print(f"heartbeat delivery failed: {error}", flush=True)
    time.sleep(interval)
