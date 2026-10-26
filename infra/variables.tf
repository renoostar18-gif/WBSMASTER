variable "project_id" {
  description = "Google Cloud project (created under the KSA organisation / CNTXT billing account)."
  type        = string
}

variable "region" {
  description = "Everything runs and is stored here. me-central2 is Dammam, Saudi Arabia."
  type        = string
  default     = "me-central2"
}

variable "domain" {
  description = "Public address of the app, e.g. app.wbsmaster.sa. Its DNS records are created by you (see outputs)."
  type        = string
}

variable "image" {
  description = "Container image to run. The deploy workflow replaces it on every release; this is only the first one."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "min_instances" {
  description = "Instances kept warm. 1 avoids cold starts; 2 or more keeps the app up while an instance restarts."
  type        = number
  default     = 1
}

variable "max_instances" {
  type    = number
  default = 10
}

variable "db_tier" {
  description = "Cloud SQL machine. db-custom-2-7680 (2 vCPU, 7.5 GB) suits the first thousands of users."
  type        = string
  default     = "db-custom-2-7680"
}

variable "db_high_availability" {
  description = "A standby in a second zone of the region, with automatic failover."
  type        = bool
  default     = true
}

variable "mail_from" {
  description = "Sender of notification emails."
  type        = string
  default     = "WBS Master <no-reply@wbs-master.example>"
}

variable "smtp_url" {
  description = "SMTP connection URL for notification emails (smtps://user:password@host:465). Empty: emails are only logged."
  type        = string
  default     = ""
  sensitive   = true
}

variable "moyasar_secret_key" {
  description = "Moyasar secret API key (sk_live_…). Empty: paid plans cannot be bought; trials still work."
  type        = string
  default     = ""
  sensitive   = true
}

variable "moyasar_webhook_secret" {
  description = "The secret token set on the Moyasar webhook (Moyasar dashboard → Settings → Webhooks)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "seller_name" {
  description = "Seller name on invoices (the registered company name)."
  type        = string
  default     = ""
}

variable "seller_name_ar" {
  description = "Seller name in Arabic on invoices."
  type        = string
  default     = ""
}

variable "seller_address" {
  description = "Seller address on invoices."
  type        = string
  default     = ""
}

variable "seller_cr" {
  description = "Commercial registration number on invoices."
  type        = string
  default     = ""
}

variable "seller_vat_number" {
  description = "VAT registration number. Leave empty while not VAT registered: invoices then have no VAT. Set it once registered to add 15% VAT and the ZATCA QR code."
  type        = string
  default     = ""
}

variable "alert_email" {
  description = "Who is emailed when the app is down."
  type        = string
}

variable "github_repository" {
  description = "owner/repo allowed to deploy with keyless authentication (Workload Identity Federation)."
  type        = string
  default     = "renoostar18-gif/WBSMASTER"
}
