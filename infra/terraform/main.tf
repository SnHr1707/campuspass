locals {
  domain = "${var.duckdns_subdomain}.duckdns.org"

  # Graviton (ARM) types have a "g" after the generation number: t4g, m7g, c7g.
  # Everything else (t3, m7i-flex, c7i-flex) is Intel/AMD. The images are built for both.
  is_arm         = can(regex("^[a-z]+[0-9]+g", var.instance_type))
  ubuntu_arch    = local.is_arm ? "arm64" : "amd64"
  ami_arch       = local.is_arm ? "arm64" : "x86_64"
  is_burstable_t = startswith(var.instance_type, "t")
}

data "aws_availability_zones" "available" {
  state = "available"
}

# Latest official Canonical Ubuntu 24.04 image for the chosen CPU type.
data "aws_ami" "ubuntu_arm" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-${local.ubuntu_arch}-server-*"]
  }

  filter {
    name   = "architecture"
    values = [local.ami_arch]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ------------------------------------------------------------------ network
# One public subnet with an Internet Gateway. No NAT Gateway (about $33/month) and no
# load balancer (about $16/month): the server's fixed public IP is all this project needs.
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "campuspass-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "campuspass-igw" }
}

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = data.aws_availability_zones.available.names[0]

  # The server gets the Elastic IP below instead of a random public IP.
  map_public_ip_on_launch = false

  tags = { Name = "campuspass-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "campuspass-public-rt" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# ------------------------------------------------------------------ firewall
# The website is open to everyone; SSH and the Kubernetes API only to the admin's IP.
resource "aws_security_group" "k3s" {
  name        = "campuspass-k3s"
  description = "CampusPass k3s server: web open to all, admin ports to admin IP only"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "campuspass-k3s" }
}

resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.k3s.id
  description       = "HTTP for redirects and Lets Encrypt challenges"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.k3s.id
  description       = "HTTPS for the CampusPass website"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  security_group_id = aws_security_group.k3s.id
  description       = "SSH from the admin IP only"
  cidr_ipv4         = var.admin_cidr
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
}

resource "aws_vpc_security_group_ingress_rule" "kube_api" {
  security_group_id = aws_security_group.k3s.id
  description       = "Kubernetes API from the admin IP only"
  cidr_ipv4         = var.admin_cidr
  ip_protocol       = "tcp"
  from_port         = 6443
  to_port           = 6443
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.k3s.id
  description       = "Outbound internet for packages, images, Lets Encrypt and DuckDNS"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# ------------------------------------------------------------------ the server
resource "aws_key_pair" "admin" {
  key_name   = "campuspass-admin"
  public_key = trimspace(file(var.ssh_public_key_path))
}

# A fixed public IP that survives stopping and starting the server.
# Created before the server, so the server's setup script already knows its address.
resource "aws_eip" "k3s" {
  domain = "vpc"

  tags = { Name = "campuspass-ip" }
}

resource "aws_instance" "k3s" {
  ami                         = data.aws_ami.ubuntu_arm.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.k3s.id]
  key_name                    = aws_key_pair.admin.key_name
  associate_public_ip_address = false

  # Burstable "t" types only: "standard" means the CPU slows down when burst credits run
  # out, instead of quietly charging extra ("unlimited" mode). Keeps the bill predictable.
  dynamic "credit_specification" {
    for_each = local.is_burstable_t ? [1] : []
    content {
      cpu_credits = "standard"
    }
  }

  # Only the token-protected metadata service (IMDSv2), which blocks a class of SSRF attacks.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_gbs
    encrypted             = true
    delete_on_termination = true
  }

  # cloud-init runs this on first boot: k3s, cert-manager, monitoring and Argo CD.
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    domain            = local.domain
    public_ip         = aws_eip.k3s.public_ip
    duckdns_subdomain = var.duckdns_subdomain
    duckdns_token     = var.duckdns_token
    git_repo_url      = var.git_repo_url
  })

  lifecycle {
    # A newer Ubuntu image appearing later should not rebuild the server.
    ignore_changes = [ami, user_data]
  }

  tags = { Name = "campuspass-k3s" }
}

resource "aws_eip_association" "k3s" {
  instance_id   = aws_instance.k3s.id
  allocation_id = aws_eip.k3s.id
}

# ------------------------------------------------------------------ cost guard
# Emails you at 50% and 80% of the monthly limit, and if AWS forecasts going over it.
resource "aws_budgets_budget" "monthly" {
  name         = "campuspass-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}
