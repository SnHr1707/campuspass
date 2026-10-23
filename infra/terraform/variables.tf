# ---- AWS account ----
variable "region" {
  description = "AWS region. ap-south-1 is Mumbai."
  type        = string
  default     = "ap-south-1"
}

variable "aws_profile" {
  description = "AWS CLI profile holding the access key (created with: aws configure --profile campuspass)."
  type        = string
  default     = "campuspass"
}

# ---- Access ----
variable "ssh_public_key_path" {
  description = "Public SSH key that may log in to the server (e.g. C:/Users/you/.ssh/id_ed25519.pub)."
  type        = string
}

variable "admin_cidr" {
  description = "Your public IP in CIDR form (e.g. 203.0.113.7/32). Only this address may use SSH and the Kubernetes API."
  type        = string

  validation {
    condition     = can(cidrhost(var.admin_cidr, 0)) && var.admin_cidr != "0.0.0.0/0"
    error_message = "admin_cidr must be a valid CIDR and must not be 0.0.0.0/0."
  }
}

# ---- Public link ----
variable "duckdns_subdomain" {
  description = "Your DuckDNS name without the suffix, e.g. \"campuspass\" for campuspass.duckdns.org."
  type        = string
}

variable "duckdns_token" {
  description = "DuckDNS token, used by the server to keep the domain pointed at its IP."
  type        = string
  sensitive   = true
}

# ---- Machine and cost ----
variable "instance_type" {
  description = "EC2 instance type, 2 vCPUs and 8 GB RAM recommended. Free plan accounts: m7i-flex.large (Intel). Paid plan: t4g.large (ARM, cheaper)."
  type        = string
  default     = "m7i-flex.large"
}

variable "root_volume_gbs" {
  description = "Disk size in GB (gp3, encrypted)."
  type        = number
  default     = 40
}

variable "monthly_budget_usd" {
  description = "Monthly spending limit for the budget alert, in US dollars."
  type        = number
  default     = 50
}

variable "alert_email" {
  description = "Email address that receives the budget alerts."
  type        = string
}

variable "git_repo_url" {
  description = "Repository Argo CD deploys from."
  type        = string
  default     = "https://github.com/SnHr1707/campuspass.git"
}
