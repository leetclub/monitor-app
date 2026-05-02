# Update Kubernetes TLS secrets for *.theleetclub.com and *.ee-coffee.com
# Run from repo root. Requires kubectl and cert files in Downloads.

param(
    [string]$Downloads = "$env:USERPROFILE\Downloads",
    [string]$TheLeetClubDir = "$Downloads\_.theleetclub.com",
    [string]$EeCoffeeDir = "$Downloads\_.ee-coffee.com",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Update-TlsSecret {
    param(
        [string]$Name,
        [string]$Namespace,
        [string]$ChainPath,
        [string]$KeyPath
    )
    if (-not (Test-Path $ChainPath)) { throw "Chain not found: $ChainPath" }
    if (-not (Test-Path $KeyPath))   { throw "Key not found: $KeyPath" }

    $kubectl = "kubectl"
    if ($DryRun) {
        Write-Host "[DRY RUN] Would create/update secret $Name in namespace $Namespace"
        return
    }
    & $kubectl create secret tls $Name `
        --cert=$ChainPath `
        --key=$KeyPath `
        --namespace=$Namespace `
        --dry-run=client -o yaml | & $kubectl apply -f -
    Write-Host "Updated secret $Name in $Namespace"
}

# --- *.theleetclub.com ---
$tcCert  = Join-Path $TheLeetClubDir "625ba359f4400ee.crt"
if (-not (Test-Path $tcCert)) { $tcCert = (Get-ChildItem -Path $TheLeetClubDir -Filter "*.crt" | Where-Object { $_.Name -notmatch "gd_bundle" } | Select-Object -First 1).FullName }
$tcBundle = Join-Path $TheLeetClubDir "gd_bundle-g2.crt"
$tcPem   = Join-Path $TheLeetClubDir "625ba359f4400ee.pem"
if (-not (Test-Path $tcPem)) { $tcPem = (Get-ChildItem -Path $TheLeetClubDir -Filter "*.pem" | Select-Object -First 1).FullName }

if (-not (Test-Path $tcCert) -or -not (Test-Path $tcBundle) -or -not (Test-Path $tcPem)) {
    Write-Warning "theleetclub cert files not found in $TheLeetClubDir (need <id>.crt, gd_bundle-g2.crt, <id>.pem). Skipping."
} else {
    $tcChain = Join-Path $env:TEMP "theleetclub-chain.crt"
    Get-Content $tcCert, $tcBundle | Set-Content $tcChain -Encoding ASCII
    Update-TlsSecret -Name "theleetclub-tls" -Namespace "leet-monitor" -ChainPath $tcChain -KeyPath $tcPem
    Remove-Item $tcChain -ErrorAction SilentlyContinue
}

# --- *.ee-coffee.com ---
$ecCert  = Join-Path $EeCoffeeDir "22321af72295307a.crt"
if (-not (Test-Path $ecCert)) { $ecCert = (Get-ChildItem -Path $EeCoffeeDir -Filter "*.crt" | Where-Object { $_.Name -notmatch "gd_bundle" } | Select-Object -First 1).FullName }
$ecBundle = Join-Path $EeCoffeeDir "gd_bundle-g2.crt"
$ecPem   = Join-Path $EeCoffeeDir "22321af72295307a.pem"
if (-not (Test-Path $ecPem)) { $ecPem = (Get-ChildItem -Path $EeCoffeeDir -Filter "*.pem" | Select-Object -First 1).FullName }

if (-not (Test-Path $ecCert) -or -not (Test-Path $ecBundle) -or -not (Test-Path $ecPem)) {
    Write-Warning "ee-coffee cert files not found in $EeCoffeeDir. Skipping."
} else {
    $ecChain = Join-Path $env:TEMP "ee-coffee-chain.crt"
    Get-Content $ecCert, $ecBundle | Set-Content $ecChain -Encoding ASCII
    # Use same namespace as theleetclub; change if your ee-coffee apps use another namespace
    Update-TlsSecret -Name "ee-coffee-tls" -Namespace "leet-monitor" -ChainPath $ecChain -KeyPath $ecPem
    Remove-Item $ecChain -ErrorAction SilentlyContinue
}

Write-Host "Done. Restart ingress controller or wait for it to reload certs if needed."
