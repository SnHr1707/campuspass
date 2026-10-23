<#
.SYNOPSIS
  Chaos test: kills a running pod and shows Kubernetes replacing it.

.DESCRIPTION
  Run this during the rush test to prove self-healing: the Deployment notices it has
  fewer pods than it should, starts a replacement, and the other pods keep serving.

.EXAMPLE
  .\scripts\chaos.ps1                         # kill one booking-service pod
  .\scripts\chaos.ps1 -App event-service
#>
param(
    [ValidateSet('booking-service', 'auth-service', 'event-service', 'ticket-service', 'api-gateway', 'frontend')]
    [string]$App = 'booking-service',
    [int]$WatchSeconds = 40
)

$ErrorActionPreference = 'Stop'

$pods = @(kubectl -n campuspass get pods -l "app=$App" --field-selector=status.phase=Running -o name)
if ($pods.Count -eq 0) { throw "No running $App pods found." }

$victim = $pods | Get-Random
Write-Host ("{0:HH:mm:ss}  Killing {1} (one of {2} running)" -f (Get-Date), $victim, $pods.Count) -ForegroundColor Red
kubectl -n campuspass delete $victim --wait=false | Out-Null

$end = (Get-Date).AddSeconds($WatchSeconds)
while ((Get-Date) -lt $end) {
    Start-Sleep -Seconds 4
    Write-Host ("`n{0:HH:mm:ss}" -f (Get-Date)) -ForegroundColor Cyan
    kubectl -n campuspass get pods -l "app=$App" -o wide --no-headers
}

$ready = kubectl -n campuspass get deployment $App -o "jsonpath={.status.readyReplicas}/{.status.replicas}"
Write-Host "`n$App ready replicas: $ready. Kubernetes replaced the killed pod automatically." -ForegroundColor Green
