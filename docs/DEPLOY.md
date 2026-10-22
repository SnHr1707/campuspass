# Deploying CampusPass to Oracle Cloud (Windows)

This guide takes you from nothing to a public HTTPS link. Everything runs from PowerShell on Windows.
Total time: about 45 minutes, most of it waiting for the VM to set itself up.

## What you need

- Tools: `winget install Git.Git Docker.DockerDesktop Kubernetes.kubectl Helm.Helm Hashicorp.Terraform Kubernetes.minikube`
  (close and reopen PowerShell afterwards)
- If PowerShell refuses to run the scripts: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
- Accounts: GitHub (you have it), Oracle Cloud, DuckDNS

## 1. Let the cluster pull your images

The first push to `main` runs the pipeline and publishes six images to GitHub Container Registry.
New packages start private, and the cluster has no GitHub login, so make them public once:

1. Open `https://github.com/SnHr1707?tab=packages`.
2. For each `campuspass-*` package: **Package settings** > **Danger Zone** > **Change visibility** > **Public**.

## 2. DuckDNS (free domain)

1. Sign in at <https://www.duckdns.org> with GitHub or Google.
2. Add a subdomain, e.g. `campuspass` (you get `campuspass.duckdns.org`). Leave the IP as it is; the VM updates it.
3. Copy the **token** shown at the top of the page.
4. If your subdomain is not `campuspass`, replace `campuspass.duckdns.org` in
   `k8s/overlays/prod/ingress-patch.yaml` (two places), then commit and push.

## 3. Oracle Cloud account and API key

1. Sign up at <https://signup.cloud.oracle.com>. Choose **India South (Hyderabad)** or **India West (Mumbai)**
   as home region; it cannot be changed later. A card is verified but Always Free resources are not charged.
2. In the console: profile icon (top right) > **My profile** > **API keys** > **Add API key** >
   **Generate API key pair** > **Download private key** > **Add**.
3. Save the private key as `C:\Users\<you>\.oci\oci_api_key.pem`.
4. The console shows a "configuration file preview". Keep it open: it has your `user`, `fingerprint`,
   `tenancy` and `region` values.

## 4. SSH key and secrets

```powershell
ssh-keygen -t ed25519            # press Enter for the defaults
cd <path-to>\campuspass
.\scripts\new-env.ps1            # writes .env with random passwords and invite codes
```

Note the organiser and volunteer invite codes it prints.

## 5. Create the infrastructure with Terraform

```powershell
cd infra\terraform
copy terraform.tfvars.example terraform.tfvars
notepad terraform.tfvars         # fill in the values from steps 2-4
curl.exe -s https://checkip.amazonaws.com   # your IP for admin_cidr, add /32
terraform init
terraform plan                   # screenshot this for the report
terraform apply                  # type "yes"
```

`terraform apply` finishes in about 2 minutes and prints your `public_ip`. The VM then spends
10 to 15 minutes installing k3s, cert-manager, Prometheus, Grafana, Loki and Argo CD by itself.

**"Out of host capacity"?** Free ARM capacity in India runs out at busy times. Set
`availability_domain_number = 2` (or 3) in `terraform.tfvars` and apply again, or retry later.
Upgrading the account to Pay As You Go keeps Always Free resources free and makes capacity easier to get.

## 6. Connect your laptop and load the secrets

```powershell
cd ..\..
.\scripts\bootstrap.ps1 -ServerIp <public_ip>
$env:KUBECONFIG = "$env:USERPROFILE\.kube\campuspass.yaml"
kubectl -n campuspass get pods
```

The script waits for the VM, saves the kubeconfig, creates the Kubernetes Secret from `.env`,
and prints the Argo CD and Grafana admin passwords.

## 7. Check it is live

- App: `https://<subdomain>.duckdns.org` (the certificate can take 2 minutes after the pods are up)
- Grafana: `https://<subdomain>.duckdns.org/grafana`
- Argo CD: `kubectl -n argocd port-forward svc/argocd-server 8443:443`, then <https://localhost:8443>

## 8. Turn on live-site checks in the pipeline

GitHub repository > **Settings** > **Secrets and variables** > **Actions** > **Variables** >
**New repository variable**: `PUBLIC_URL` = `https://<subdomain>.duckdns.org`.

From now on every push to `main` waits for Argo CD to roll out the new build, checks the live site's
security headers and runs an OWASP ZAP scan.

## Optional: protect `main`

Settings > Branches > Add rule for `main`: require a pull request and require the status checks
`Secret scan (Gitleaks)`, `Code scan (Semgrep)` and `Config scan (Trivy + Hadolint + kubeconform)`.

## Tearing down

```powershell
cd infra\terraform
terraform destroy
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Pods stuck in `ImagePullBackOff` | The GHCR packages are still private (step 1). |
| Pods stuck in `CreateContainerConfigError` | The Secret is missing: run `bootstrap.ps1` again. |
| Argo CD app shows "unable to resolve gitops" | The pipeline has not finished a run on `main` yet. |
| Browser warns about the certificate | Wait 2 minutes; check `kubectl -n campuspass get certificate`. |
| `bootstrap.ps1` cannot SSH | Your IP changed: update `admin_cidr` and run `terraform apply`. |
| Setup log | `ssh ubuntu@<ip> "sudo tail -50 /var/log/campuspass-bootstrap.log"` |
