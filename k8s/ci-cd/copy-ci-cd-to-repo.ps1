# Copies CI/CD files from this repo (monitoring-app) into your target app repo.
# Usage: .\copy-ci-cd-to-repo.ps1 -Target "C:\path\to\your\repo"
# Example: .\copy-ci-cd-to-repo.ps1 -Target "..\Leet Monitor"

param(
    [Parameter(Mandatory = $true)]
    [string] $Target
)

$ErrorActionPreference = "Stop"
$ScriptDir = $PSScriptRoot

$targetK8s = Join-Path $Target "k8s\ci-cd"
New-Item -ItemType Directory -Force -Path $targetK8s | Out-Null

Copy-Item (Join-Path $ScriptDir "get-version.sh") -Destination $targetK8s -Force
Copy-Item (Join-Path $ScriptDir "azure-pipelines.build-deploy.yml") -Destination $targetK8s -Force
Copy-Item (Join-Path $ScriptDir "example-one-repo-azure-pipelines.yml") -Destination $targetK8s -Force
Copy-Item (Join-Path $ScriptDir "README.md") -Destination $targetK8s -Force
Copy-Item (Join-Path $ScriptDir "example-one-repo-azure-pipelines.yml") -Destination (Join-Path $Target "azure-pipelines.yml") -Force

Write-Host "Done. Copied to $Target :" -ForegroundColor Green
Write-Host "  k8s\ci-cd\get-version.sh"
Write-Host "  k8s\ci-cd\azure-pipelines.build-deploy.yml"
Write-Host "  k8s\ci-cd\example-one-repo-azure-pipelines.yml"
Write-Host "  k8s\ci-cd\README.md"
Write-Host "  azure-pipelines.yml  (from example; edit parameters: imageName, k8sDeployment, approvalNotifyUsers)"
Write-Host ""
Write-Host "Next: open target repo, edit azure-pipelines.yml parameters, then add pipeline in Azure DevOps." -ForegroundColor Cyan
