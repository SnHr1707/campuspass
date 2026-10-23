# Demo script (about 10 minutes)

Open these before you start: the live site on your phone, Grafana's "CampusPass: Registration Rush"
dashboard, the GitHub Actions tab, and two PowerShell windows with `$env:KUBECONFIG` set.

1. **Public link (1 min).** On your phone open the site, create an account, book a seat, show the QR ticket.
2. **Microservices (1 min).** Show the architecture diagram in the README, then
   `kubectl -n campuspass get pods,svc`.
3. **Docker (1 min).** Open `services/event-service/Dockerfile` (multi-stage, layered, non-root).
   Run `docker compose up --build` to show the whole system starting on a laptop.
4. **Infrastructure as Code (1 min).** Show `infra/terraform/main.tf`, then `terraform plan`:
   "No changes" proves the live infrastructure matches the code.
5. **CI/CD (2 min).** Change the heading text in `services/frontend/src/pages/EventsPage.jsx`, push,
   and walk through the pipeline. When it finishes, the footer's build number changes on the live site.
6. **DevSecOps (1 min).** Show the Security tab (Semgrep findings), the SBOM artifacts, and the
   SHA-pinned actions with the Trivy incident comment at the top of `ci-cd.yml`.
7. **The rush (2 min).** In window 1: `kubectl -n campuspass get hpa,pods -w`.
   In window 2: `.\scripts\rush.ps1`. On Grafana, bookings spike, booking-service goes from 1 to more
   pods, and seats left stops at exactly 0. k6 reports 100 confirmed, 400 sold out, 0 errors.
8. **Self-healing (1 min).** While the rush runs: `.\scripts\chaos.ps1`. The killed pod is replaced,
   the restart appears on the dashboard, and the seat count is still exactly 100.
9. **Gate check-in (30 s).** Log in as a volunteer (invite code from `.env`), open Gate check-in,
   scan the phone's ticket: "Let them in". Scan again: "Already scanned".

Record the whole run once as a backup video in case the network fails on the day.
