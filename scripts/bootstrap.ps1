<#
.SYNOPSIS
  Connects your laptop to the CampusPass k3s cluster and loads the app's secrets.

.DESCRIPTION
  Run once after "terraform apply". It:
    1. waits for the VM's first-boot setup (k3s, cert-manager, monitoring, Argo CD) to finish
    2. copies the cluster's kubeconfig to %USERPROFILE%\.kube\campuspass.yaml
    3. creates the "campuspass-secrets" Kubernetes Secret from your .env file
    4. prints the Argo CD and Grafana admin passwords

.EXAMPLE
  .\scripts\bootstrap.ps1 -ServerIp 141.148.10.20
#>
param(
    [Parameter(Mandatory = $true)][string]$ServerIp,
    [string]$SshKey = (Join-Path $env:USERPROFILE '.ssh\id_ed25519'),
    [string]$EnvFile = (Join-Path $PSScriptRoot '..\.env')
)

# 'Continue', not 'Stop': in Windows PowerShell 5.1, anything ssh or kubectl writes to stderr
# (even a harmless "Permanently added ... to known hosts" note) would otherwise abort the script.
# Real failures are caught below by checking $LASTEXITCODE.
$ErrorActionPreference = 'Continue'

function Assert-Success([string]$What) {
    if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE). See the messages above." }
}

function Invoke-Remote([string]$Command) {
    & ssh -i $SshKey -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o LogLevel=ERROR "ubuntu@$ServerIp" $Command 2>$null
}

function Get-SecretValue([string]$Namespace, [string]$Name, [string]$Key) {
    $encoded = kubectl -n $Namespace get secret $Name -o "jsonpath={.data.$Key}" 2>$null
    if (-not $encoded) { return '(not found)' }
    return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
}

# ---- 0. check the .env before touching anything --------------------------------
if (-not (Test-Path $EnvFile)) {
    throw ".env not found. Create one with: .\scripts\new-env.ps1"
}
if (Select-String -Path $EnvFile -Pattern 'change-me|local-dev' -Quiet) {
    throw ".env still has the example values. Create real secrets with: .\scripts\new-env.ps1 -Force"
}

# ---- 1. wait for cloud-init -----------------------------------------------------
Write-Host "Waiting for the VM's first-boot setup to finish (usually 10-15 minutes)..." -ForegroundColor Cyan
$deadline = (Get-Date).AddMinutes(40)
while ($true) {
    $state = Invoke-Remote 'test -f /var/lib/campuspass-bootstrap-done && echo done || sudo tail -n 1 /var/log/campuspass-bootstrap.log 2>/dev/null'
    if ($state -eq 'done') { break }
    if ((Get-Date) -gt $deadline) {
        throw "Setup did not finish in 40 minutes. Check: ssh ubuntu@$ServerIp 'sudo tail -50 /var/log/campuspass-bootstrap.log'"
    }
    $last = if ($state) { ($state | Select-Object -Last 1) } else { 'VM not reachable yet' }
    if ($last.Length -gt 100) { $last = $last.Substring(0, 100) }
    Write-Host ("  {0:HH:mm:ss}  {1}" -f (Get-Date), $last)
    Start-Sleep -Seconds 30
}
Write-Host "Platform is ready." -ForegroundColor Green

# ---- 2. kubeconfig --------------------------------------------------------------
$kubeDir = Join-Path $env:USERPROFILE '.kube'
New-Item -ItemType Directory -Force -Path $kubeDir | Out-Null
$kubePath = Join-Path $kubeDir 'campuspass.yaml'
$kubeconfig = (Invoke-Remote 'sudo cat /etc/rancher/k3s/k3s.yaml') -join "`n"
if (-not ($kubeconfig -match 'certificate-authority-data')) {
    throw "Could not read the kubeconfig from the server. Try: ssh ubuntu@$ServerIp 'sudo ls -l /etc/rancher/k3s/k3s.yaml'"
}
$kubeconfig = $kubeconfig.Replace('https://127.0.0.1:6443', "https://${ServerIp}:6443").Replace('name: default', 'name: campuspass').Replace('cluster: default', 'cluster: campuspass').Replace('user: default', 'user: campuspass').Replace('current-context: default', 'current-context: campuspass')
Set-Content -Path $kubePath -Value $kubeconfig -Encoding ascii
$env:KUBECONFIG = $kubePath
kubectl get nodes -o wide
Assert-Success "Connecting to the cluster (is admin_cidr in terraform.tfvars still your current IP?)"

# ---- 3. secrets -----------------------------------------------------------------
Write-Host "Creating the campuspass-secrets Secret from $EnvFile ..." -ForegroundColor Cyan
kubectl create namespace campuspass --dry-run=client -o yaml | kubectl apply -f - | Out-Null
kubectl -n campuspass create secret generic campuspass-secrets --from-env-file=$EnvFile --dry-run=client -o yaml | kubectl apply -f -
Assert-Success "Creating the campuspass-secrets Secret"

# Pods that started before the Secret existed retry by themselves; this just speeds it up.
kubectl -n campuspass rollout restart deployment 2>$null | Out-Null

# ---- 4. summary -----------------------------------------------------------------
$argoPassword = Get-SecretValue 'argocd' 'argocd-initial-admin-secret' 'password'
$grafanaPassword = Get-SecretValue 'monitoring' 'kps-grafana' 'admin-password'

Write-Host ""
Write-Host "All set. For future PowerShell sessions run:" -ForegroundColor Green
Write-Host "  `$env:KUBECONFIG = '$kubePath'"
Write-Host ""
Write-Host "Argo CD   : kubectl -n argocd port-forward svc/argocd-server 8443:443   then open https://localhost:8443"
Write-Host "            user: admin   password: $argoPassword"
Write-Host "Grafana   : https://<your-domain>/grafana  (read-only for visitors)"
Write-Host "            user: admin   password: $grafanaPassword"
Write-Host "App pods  : kubectl -n campuspass get pods"
