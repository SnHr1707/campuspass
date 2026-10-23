terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # State is kept in a local, git-ignored file. For a team you would move it to an
  # S3 bucket (with locking) so everyone shares one state.
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile

  # Every resource gets these tags, so the project's cost is easy to find in the billing console.
  default_tags {
    tags = {
      project    = "campuspass"
      managed_by = "terraform"
    }
  }
}
