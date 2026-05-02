import json
import os
import urllib.request

k = os.environ.get("DASHBOARD_ACCESS_API_KEY", "")
req = urllib.request.Request(
    "http://127.0.0.1:5000/api/dashboard-access/resolve",
    data=json.dumps({"email": "test@theleetclub.com"}).encode(),
    headers={"Content-Type": "application/json", "X-Dashboard-Access-Secret": k},
)
with urllib.request.urlopen(req) as r:
    print(r.read().decode()[:800])
