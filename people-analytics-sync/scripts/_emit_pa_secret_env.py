#!/usr/bin/env python3
"""Print export lines for DB/Vendon env from people-analytics-secrets."""
import base64
import json
import subprocess
import sys

kubeconfig = sys.argv[1] if len(sys.argv) > 1 else ""
cmd = [
    "kubectl",
    "get",
    "secret",
    "people-analytics-secrets",
    "-n",
    "leet-monitor",
    "-o",
    "json",
]
env = None
if kubeconfig:
    env = dict(**{**subprocess.os.environ, "KUBECONFIG": kubeconfig})
raw = subprocess.check_output(cmd, env=env)
sec = json.loads(raw)["data"]


def g(*keys):
    for k in keys:
        if k in sec:
            return base64.b64decode(sec[k]).decode()
    return None


pairs = {
    "DB_HOST": g("db-host", "DB_HOST"),
    "DB_PORT": g("db-port", "DB_PORT") or "25060",
    "DB_NAME": g("db-name", "DB_NAME") or "people_analytics",
    "DB_USER": g("db-user", "DB_USER"),
    "DB_PASSWORD": g("db-password", "DB_PASSWORD"),
    "VENDON_API_KEY": g("vendon-api-key", "VENDON_API_KEY"),
    "VENDON_API_BASE": g("vendon-api-base", "VENDON_API_BASE")
    or "https://cloud.vendon.net/rest/v1.9.0",
}
for k, v in pairs.items():
    if not v:
        print(f"missing {k}", file=sys.stderr)
        sys.exit(1)
    ev = v.replace("'", "'\"'\"'")
    print(f"export {k}='{ev}'")
