# Wildcard TLS certs update (*.theleetclub.com & *.ee-coffee.com)

Your wildcard certs are renewed and stored under Downloads. **GoDaddy only provides certificates** (`.crt`/`.pem`); the **private key** is the one you created when generating the CSR and is not in the download.

- **\_.theleetclub.com:** `625ba359f4400ee.crt`, `gd_bundle-g2.crt`, and **you must add** the private key (e.g. `theleetclub.key` or `625ba359f4400ee.key`).
- **\_.ee-coffee.com:** `22321af72295307a.crt`, `gd_bundle-g2.crt`, and **you must add** the private key (e.g. `ee-coffee.key`).

Place each private key in the same folder as the certs. The script looks for a `.key` file (or a `.pem` that is actually a key) in each folder.

## Quick update (recommended)

From the **monitoring-app** repo root, with `kubectl` pointing at your cluster:

**PowerShell (Windows):**
```powershell
cd k8s
.\update-wildcard-certs.ps1
```

**Preview without applying:**
```powershell
.\update-wildcard-certs.ps1 -DryRun
```

**Bash (WSL / Git Bash):** if certs are under Windows Downloads:
```bash
cd k8s
# WSL: Windows Downloads are e.g. /mnt/c/Users/YourUser/Downloads
export DOWNLOADS="/mnt/c/Users/$USER/Downloads"
chmod +x update-wildcard-certs.sh
./update-wildcard-certs.sh
```

Dry run:
```bash
DRY_RUN=1 ./update-wildcard-certs.sh
```

## What the script does

1. **theleetclub:** builds full chain = `625ba359f4400ee.crt` + `gd_bundle-g2.crt`, uses `625ba359f4400ee.pem` as private key, then creates/updates the `theleetclub-tls` secret in namespace `leet-monitor`.
2. **ee-coffee:** same for the ee-coffee files and creates/updates `ee-coffee-tls` in `leet-monitor`.

All ingresses in this repo that use `secretName: theleetclub-tls` will pick up the new cert once the secret is updated. No need to change Ingress YAML.

## ee-coffee namespace

The script uses namespace **leet-monitor** for both secrets. If your ee-coffee apps run in a **different namespace**, either:

- Edit `update-wildcard-certs.ps1` / `update-wildcard-certs.sh` and change the namespace for the ee-coffee secret, or  
- After running the script, copy the secret to the right namespace:
  ```bash
  kubectl get secret ee-coffee-tls -n leet-monitor -o yaml | sed 's/namespace: leet-monitor/namespace: YOUR-EE-COFFEE-NAMESPACE/' | kubectl apply -f -
  ```

If your ee-coffee Ingress uses a different **secret name** (e.g. `tls-secret`), create/update that name instead, e.g.:

```bash
kubectl create secret tls YOUR-SECRET-NAME --cert=chain.crt --key=key.pem -n YOUR-NAMESPACE --dry-run=client -o yaml | kubectl apply -f -
```

(using the same chain = domain cert + `gd_bundle-g2.crt` and the same `.pem` as key.)

## Ingresses in this repo (theleetclub only)

- `people-analytics-sync/k8s/api-ingress.yaml` → `people-api.theleetclub.com` → `theleetclub-tls`
- `apps/vendon-sync/k8s/api-ingress.yaml` → `vendon-api.theleetclub.com` → `theleetclub-tls`
- `apps/historical-performance-sync/k8s/api-ingress.yaml` → `historical-api.theleetclub.com` → `theleetclub-tls`

Updating the `theleetclub-tls` secret is enough for these. For any other app under *.theleetclub.com or *.ee-coffee.com (e.g. admin, other repos), update the TLS secret that their Ingress references in the same way.

## Optional: stop committing the TLS secret

`people-analytics-sync/k8s/theleetclub-tls.yaml` currently contains an old TLS secret (with private key). For security, prefer **not** storing private keys in git. After you’ve applied the new cert with the script above, you can:

- Remove `theleetclub-tls.yaml` from the repo and add it to `.gitignore`, and rely on applying from local cert files (or a secret manager), or  
- Keep the file only as a template and strip the `data` section so the real secret is only created by the script or CI.

After updating, you can confirm in the cluster:

```bash
kubectl get secret theleetclub-tls -n leet-monitor -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -noout -dates
```

You should see `notAfter` with the new expiry date.
