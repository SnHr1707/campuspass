output "public_ip" {
  description = "Public IP of the k3s VM."
  value       = oci_core_instance.k3s.public_ip
}

output "app_url" {
  description = "Your public CampusPass link (live about 10 minutes after the VM is created)."
  value       = "https://${local.domain}"
}

output "grafana_url" {
  description = "Read-only monitoring dashboards."
  value       = "https://${local.domain}/grafana"
}

output "ssh_command" {
  description = "Log in to the VM."
  value       = "ssh ubuntu@${oci_core_instance.k3s.public_ip}"
}

output "next_step" {
  description = "What to run next."
  value       = "Run .\\scripts\\bootstrap.ps1 -ServerIp ${oci_core_instance.k3s.public_ip}"
}
