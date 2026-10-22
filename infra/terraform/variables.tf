# ---- Oracle Cloud API credentials (from the API key you create in the console) ----
variable "tenancy_ocid" {
  description = "OCID of your tenancy (Profile > Tenancy)."
  type        = string
}

variable "user_ocid" {
  description = "OCID of your user (Profile > My profile)."
  type        = string
}

variable "fingerprint" {
  description = "Fingerprint of the API signing key you uploaded."
  type        = string
}

variable "private_key_path" {
  description = "Path to the API signing private key (.pem) on your laptop."
  type        = string
}

variable "region" {
  description = "Your home region, e.g. ap-mumbai-1 or ap-hyderabad-1."
  type        = string
}

variable "compartment_ocid" {
  description = "Compartment to create resources in. Leave empty to use the tenancy root."
  type        = string
  default     = ""
}

# ---- Access ----
variable "ssh_public_key_path" {
  description = "Public SSH key that may log in to the VM (e.g. C:/Users/you/.ssh/id_ed25519.pub)."
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
  description = "DuckDNS token, used by the VM to keep the domain pointed at its IP."
  type        = string
  sensitive   = true
}

# ---- Machine size (Always Free allows up to 4 OCPUs and 24 GB on Ampere A1) ----
variable "ocpus" {
  description = "Ampere A1 OCPUs (Always Free limit: 4 in total)."
  type        = number
  default     = 4
}

variable "memory_gbs" {
  description = "Memory in GB (Always Free limit: 24 in total)."
  type        = number
  default     = 24
}

variable "boot_volume_gbs" {
  description = "Boot disk size in GB (Always Free includes 200 GB of block storage)."
  type        = number
  default     = 100
}

variable "availability_domain_number" {
  description = "Which availability domain to use (1, 2 or 3). Try another if you see \"Out of host capacity\"."
  type        = number
  default     = 1
}

variable "git_repo_url" {
  description = "Repository Argo CD deploys from."
  type        = string
  default     = "https://github.com/SnHr1707/campuspass.git"
}
