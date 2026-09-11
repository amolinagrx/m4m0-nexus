terraform {
  required_providers {
    m4m0nexus = {
      source  = "m4m0/m4m0nexus"
      version = "0.1.0"
    }
  }
}
variable "nexus_token" {
  type = string
  sensitive = true
}
variable "proxmox_token" {
  type = string
  sensitive = true
}
provider "m4m0nexus" {
  endpoint  = "https://nexus.example.com"
  api_token = var.nexus_token
}
resource "m4m0nexus_infrastructure" "proxmox" {
  name      = "proxmox-prod"
  type      = "proxmox"
  endpoint  = "https://pve.example.com:8006"
  token_id  = "nexus@pve!terraform"
  api_token = var.proxmox_token
}
resource "m4m0nexus_vm" "web" {
  infrastructure_id = m4m0nexus_infrastructure.proxmox.id
  name              = "web-server-01"
  template_id       = "pve-node-01/qemu/9000"
  cpus              = 4
  memory_mb         = 8192
  disk_gb           = 100
}
resource "m4m0nexus_webhook" "alerts" {
  name   = "Operations alerts"
  url    = "https://hooks.slack.com/services/replace-me"
  events = ["vm.started", "vm.stopped", "backup.failed"]
}
