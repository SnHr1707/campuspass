<#
.SYNOPSIS
  Runs CampusPass on Minikube (Kubernetes on your laptop).

.DESCRIPTION
  Builds the images straight into Minikube's Docker, applies the "local" Kustomize overlay,
  waits for every pod, then opens a tunnel to http://localhost:3000.

.EXAMPLE
  .\scripts\local-k8s.ps1
#>
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$status = minikube status --format '{{.Host}}' 2>$null
if ($status -ne 'Running') {
    Write-Host "Starting Minikube (first time takes a few minutes)..." -ForegroundColor Cyan
    minikube start --cpus 4 --memory 6g --driver docker
}
minikube addons enable metrics-server | Out-Null
minikube addons enable ingress | Out-Null

Write-Host "Building images inside Minikube..." -ForegroundColor Cyan
& minikube -p minikube docker-env --shell powershell | Invoke-Expression
docker compose build

Write-Host "Deploying the local overlay..." -ForegroundColor Cyan
kubectl apply -k k8s/overlays/local
kubectl -n campuspass rollout status statefulset/postgres --timeout=5m
kubectl -n campuspass rollout status statefulset/mongo --timeout=5m
foreach ($d in 'auth-service', 'event-service', 'booking-service', 'ticket-service', 'api-gateway', 'frontend') {
    kubectl -n campuspass rollout status deployment/$d --timeout=5m
}
kubectl -n campuspass get pods,svc,hpa

Write-Host "`nOpen http://localhost:3000  (Ctrl+C stops the tunnel; the cluster keeps running)" -ForegroundColor Green
kubectl -n campuspass port-forward svc/frontend 3000:8080
