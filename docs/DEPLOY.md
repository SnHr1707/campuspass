# Deploying CampusPass to AWS (Windows)

This guide takes you from nothing to a public HTTPS link on one AWS EC2 server, paid from the
AWS credits. Everything runs from PowerShell. Total time: about an hour, mostly waiting.

**Cost:** about $40/month (t4g.large in Mumbai about $33, fixed public IP about $3.65, 40 GB disk about $3.50).
Terraform also creates a budget alert that emails you at 50% and 80% of $50/month.

## What you need

- The latest pipeline run on `main` is green (Actions tab). It builds the images the server pulls.
- Tools (close and reopen PowerShell afterwards):
  ```powershell
  winget install Amazon.AWSCLI Hashicorp.Terraform Kubernetes.kubectl Helm.Helm
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
  ```

## 1. Make the images public (GitHub)

The server has no GitHub login, so it can only pull public images.
Open `https://github.com/SnHr1707?tab=packages`, and for each `campuspass-*` package:
**Package settings** > **Change visibility** > **Public**.

## 2. DuckDNS (free domain)

1. Sign in at <https://www.duckdns.org> with GitHub or Google.
2. Add a subdomain, e.g. `campuspass` (you get `campuspass.duckdns.org`). Leave the IP as it is; the server sets it.
3. Copy the **token** shown at the top of the page.
4. If your subdomain is not `campuspass`, replace `campuspass.duckdns.org` in
   `k8s/overlays/prod/ingress-patch.yaml` (two places), then commit and push.

## 3. An AWS access key for Terraform

Do not use the root account's keys. Create a separate user for Terraform:

1. AWS console > **IAM** > **Users** > **Create user**. Name: `campuspass-terraform`. Next.
2. **Attach policies directly** > tick **AdministratorAccess** > Next > **Create user**.
3. Open the new user > **Security credentials** > **Create access key** >
   **Command Line Interface (CLI)** > tick the confirmation > Next > **Create access key**.
4. Keep this page open, then in PowerShell:
   ```powershell
   aws configure --profile campuspass
   #   AWS Access Key ID:     paste the access key
   #   AWS Secret Access Key: paste the secret key
   #   Default region name:   ap-south-1
   #   Default output format: json
   aws sts get-caller-identity --profile campuspass    # should print your account number
   ```

The keys are stored in `%USERPROFILE%\.aws\credentials`, never in the project.

## 4. SSH key and app secrets

```powershell
ssh-keygen -t ed25519          # press Enter at every question
cd "$env:USERPROFILE\Desktop\campuspass-team"
.\scripts\new-env.ps1          # creates .env with random passwords and invite codes
```

Note the organiser and volunteer invite codes it prints.

## 5. Create the infrastructure with Terraform

```powershell
cd infra\terraform
copy terraform.tfvars.example terraform.tfvars
curl.exe -s https://checkip.amazonaws.com    # your public IP for admin_cidr (add /32)
notepad terraform.tfvars
```

| Setting | Value |
|---|---|
| `ssh_public_key_path` | `C:/Users/<you>/.ssh/id_ed25519.pub` (forward slashes) |
| `admin_cidr` | your IP from the curl command plus `/32`, e.g. `49.36.12.7/32` |
| `duckdns_subdomain` | e.g. `campuspass` |
| `duckdns_token` | the token from step 2 |
| `alert_email` | where budget alerts should go |

```powershell
terraform init
terraform plan        # screenshot this for the report
terraform apply       # type "yes"
```

`terraform apply` takes about 2 minutes and prints `public_ip`, `app_url` and `grafana_url`.
AWS then emails `alert_email` to confirm the budget subscription; click the link.
The server spends 10 to 15 minutes installing k3s, cert-manager, Prometheus, Grafana, Loki and Argo CD.

## 6. Connect your laptop and load the secrets

```powershell
cd ..\..
.\scripts\bootstrap.ps1 -ServerIp <public_ip>
$env:KUBECONFIG = "$env:USERPROFILE\.kube\campuspass.yaml"
kubectl -n campuspass get pods        # all Running within a few minutes
```

The script waits for the server, saves the kubeconfig, creates the Kubernetes Secret from `.env`,
and prints the Argo CD and Grafana admin passwords.

## 7. Check it is live

- App: `https://<subdomain>.duckdns.org` (the certificate can take 2 minutes after the pods are up)
- Grafana: `https://<subdomain>.duckdns.org/grafana`
- Argo CD: `kubectl -n argocd port-forward svc/argocd-server 8443:443`, then <https://localhost:8443>

## 8. Turn on live-site checks in the pipeline

GitHub repository > **Settings** > **Secrets and variables** > **Actions** > **Variables** >
**New repository variable**: `PUBLIC_URL` = `https://<subdomain>.duckdns.org`.

Every push to `main` then waits for Argo CD to roll out the new build, checks the live site's
security headers and runs an OWASP ZAP scan.

## Saving credits

- **Stop the server when nobody needs it** (the disk and IP are kept; everything starts again by itself):
  ```powershell
  $id = aws ec2 describe-instances --profile campuspass --filters "Name=tag:Name,Values=campuspass-k3s" --query "Reservations[0].Instances[0].InstanceId" --output text
  aws ec2 stop-instances  --profile campuspass --instance-ids $id
  aws ec2 start-instances --profile campuspass --instance-ids $id
  ```
  Keep it running from submission until grading is finished, so the link always works.
- **After grading**, delete everything: `terraform destroy` (from `infra\terraform`), then delete the
  `campuspass-terraform` user's access key in IAM.
- Never create EKS, a NAT Gateway or a load balancer for this project; each would cost more than the server.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `terraform apply` says the instance type is not allowed | Free plan accounts can block some types. Upgrade to the Paid plan in Billing (credits still apply), or set `instance_type = "t4g.medium"`. |
| `No valid credential sources found` | Run `aws configure --profile campuspass` again (step 3). |
| Pods stuck in `ImagePullBackOff` | The GHCR packages are still private (step 1). |
| Pods stuck in `CreateContainerConfigError` | The Secret is missing: run `bootstrap.ps1` again. |
| Argo CD app shows "unable to resolve gitops" | The pipeline has not finished a run on `main` yet. |
| Browser warns about the certificate | Wait 2 minutes; check `kubectl -n campuspass get certificate`. |
| `bootstrap.ps1` or `kubectl` cannot connect | Your IP changed (e.g. college Wi-Fi vs home): update `admin_cidr`, run `terraform apply`. |
| Setup log | `ssh ubuntu@<ip> "sudo tail -50 /var/log/campuspass-bootstrap.log"` |
