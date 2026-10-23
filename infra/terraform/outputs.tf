output "public_ip" {
  description = "Fixed public IP (Elastic IP) of the k3s server."
  value       = aws_eip.k3s.public_ip
}

output "app_url" {
  description = "Your public CampusPass link (live about 15 minutes after the server is created)."
  value       = "https://${local.domain}"
}

output "grafana_url" {
  description = "Read-only monitoring dashboards."
  value       = "https://${local.domain}/grafana"
}

output "ssh_command" {
  description = "Log in to the server."
  value       = "ssh ubuntu@${aws_eip.k3s.public_ip}"
}

output "next_step" {
  description = "What to run next."
  value       = "Run .\\scripts\\bootstrap.ps1 -ServerIp ${aws_eip.k3s.public_ip}"
}
