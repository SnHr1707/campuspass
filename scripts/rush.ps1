<#
.SYNOPSIS
  Runs the registration-rush load test inside the cluster as a Kubernetes Job.

.DESCRIPTION
  Running k6 inside the cluster means your home internet speed does not limit the test.
  While it runs, watch the "CampusPass: Registration Rush" dashboard in Grafana and
  "kubectl -n campuspass get hpa,pods -w" to see booking-service scale up.

.EXAMPLE
  .\scripts\rush.ps1                       # 500 students, 100 seats
  .\scripts\rush.ps1 -Students 1000 -Seats 150
#>
param(
    [int]$Students = 500,
    [int]$Seats = 100
)

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '..\load-tests\rush.js'

kubectl -n campuspass delete job k6-rush --ignore-not-found | Out-Null
kubectl -n campuspass create configmap k6-rush-script --from-file=rush.js=$script --dry-run=client -o yaml | kubectl apply -f - | Out-Null

$job = @"
apiVersion: batch/v1
kind: Job
metadata:
  name: k6-rush
  namespace: campuspass
  labels: { app: k6-rush }
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 3600
  template:
    metadata:
      labels: { app: k6-rush }
    spec:
      restartPolicy: Never
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 12345
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: k6
          image: grafana/k6:1.3.0
          args: ["run", "/scripts/rush.js"]
          env:
            - { name: BASE_URL, value: "http://api-gateway:8080" }
            - { name: STUDENTS, value: "$Students" }
            - { name: SEATS, value: "$Seats" }
            - name: ORGANISER_INVITE_CODE
              valueFrom: { secretKeyRef: { name: campuspass-secrets, key: ORGANISER_INVITE_CODE } }
          resources:
            requests: { cpu: 500m, memory: 256Mi }
            limits: { cpu: "2", memory: 1Gi }
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          volumeMounts:
            - { name: scripts, mountPath: /scripts, readOnly: true }
            - { name: tmp, mountPath: /tmp }
      volumes:
        - name: scripts
          configMap: { name: k6-rush-script }
        - name: tmp
          emptyDir: {}
"@

$job | kubectl apply -f - | Out-Null
Write-Host "Rush test started: $Students students, $Seats seats. Streaming results..." -ForegroundColor Cyan
Write-Host "Tip: in another window run  kubectl -n campuspass get hpa,pods -w" -ForegroundColor DarkGray
kubectl -n campuspass wait --for=condition=Ready pod -l job-name=k6-rush --timeout=180s | Out-Null
kubectl -n campuspass logs -f job/k6-rush

$status = kubectl -n campuspass get job k6-rush -o "jsonpath={.status.succeeded}"
if ($status -eq '1') {
    Write-Host "PASSED: exactly $Seats seats sold, no server errors." -ForegroundColor Green
} else {
    Write-Host "FAILED: see the k6 output above." -ForegroundColor Red
    exit 1
}
