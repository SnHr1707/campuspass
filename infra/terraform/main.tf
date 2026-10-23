locals {
  compartment_id = var.compartment_ocid != "" ? var.compartment_ocid : var.tenancy_ocid
  domain         = "${var.duckdns_subdomain}.duckdns.org"
  tags           = { project = "campuspass", managed_by = "terraform" }
}

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

# Latest Canonical Ubuntu 24.04 image built for ARM (Ampere A1).
data "oci_core_images" "ubuntu_arm" {
  compartment_id           = local.compartment_id
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

# ------------------------------------------------------------------ network
resource "oci_core_vcn" "main" {
  compartment_id = local.compartment_id
  display_name   = "campuspass-vcn"
  cidr_blocks    = ["10.0.0.0/16"]
  dns_label      = "campuspass"
  freeform_tags  = local.tags
}

resource "oci_core_internet_gateway" "main" {
  compartment_id = local.compartment_id
  vcn_id         = oci_core_vcn.main.id
  display_name   = "campuspass-igw"
  enabled        = true
  freeform_tags  = local.tags
}

resource "oci_core_route_table" "public" {
  compartment_id = local.compartment_id
  vcn_id         = oci_core_vcn.main.id
  display_name   = "campuspass-public-rt"
  freeform_tags  = local.tags

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.main.id
  }
}

# Cloud firewall: the website is open to everyone; SSH and the Kubernetes API only to you.
resource "oci_core_security_list" "public" {
  compartment_id = local.compartment_id
  vcn_id         = oci_core_vcn.main.id
  display_name   = "campuspass-public-sl"
  freeform_tags  = local.tags

  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
    description = "Outbound internet (package installs, image pulls, Let's Encrypt)"
  }

  ingress_security_rules {
    source      = "0.0.0.0/0"
    protocol    = "6"
    description = "HTTP (redirects and Let's Encrypt challenges)"
    tcp_options {
      min = 80
      max = 80
    }
  }

  ingress_security_rules {
    source      = "0.0.0.0/0"
    protocol    = "6"
    description = "HTTPS (the CampusPass website)"
    tcp_options {
      min = 443
      max = 443
    }
  }

  ingress_security_rules {
    source      = var.admin_cidr
    protocol    = "6"
    description = "SSH from the admin's IP only"
    tcp_options {
      min = 22
      max = 22
    }
  }

  ingress_security_rules {
    source      = var.admin_cidr
    protocol    = "6"
    description = "Kubernetes API from the admin's IP only"
    tcp_options {
      min = 6443
      max = 6443
    }
  }

  ingress_security_rules {
    source      = "0.0.0.0/0"
    protocol    = "1"
    description = "ICMP fragmentation-needed, required for correct MTU discovery"
    icmp_options {
      type = 3
      code = 4
    }
  }
}

resource "oci_core_subnet" "public" {
  compartment_id    = local.compartment_id
  vcn_id            = oci_core_vcn.main.id
  display_name      = "campuspass-public-subnet"
  cidr_block        = "10.0.1.0/24"
  dns_label         = "public"
  route_table_id    = oci_core_route_table.public.id
  security_list_ids = [oci_core_security_list.public.id]
  freeform_tags     = local.tags
}

# ------------------------------------------------------------------ the VM
resource "oci_core_instance" "k3s" {
  compartment_id      = local.compartment_id
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[var.availability_domain_number - 1].name
  display_name        = "campuspass-k3s"
  shape               = "VM.Standard.A1.Flex"
  freeform_tags       = local.tags

  shape_config {
    ocpus         = var.ocpus
    memory_in_gbs = var.memory_gbs
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu_arm.images[0].id
    boot_volume_size_in_gbs = var.boot_volume_gbs
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.public.id
    assign_public_ip = true
    hostname_label   = "k3s"
  }

  # Only the newer, token-protected metadata endpoint (blocks a class of SSRF attacks).
  instance_options {
    are_legacy_imds_endpoints_disabled = true
  }

  metadata = {
    ssh_authorized_keys = trimspace(file(var.ssh_public_key_path))
    # cloud-init runs this on first boot: firewall, k3s, cert-manager, Argo CD, monitoring.
    user_data = base64encode(templatefile("${path.module}/cloud-init.yaml.tftpl", {
      domain            = local.domain
      duckdns_subdomain = var.duckdns_subdomain
      duckdns_token     = var.duckdns_token
      git_repo_url      = var.git_repo_url
    }))
  }

  lifecycle {
    # A newer Ubuntu image appearing later should not rebuild the server.
    ignore_changes = [source_details[0].source_id, metadata["user_data"]]
  }
}
