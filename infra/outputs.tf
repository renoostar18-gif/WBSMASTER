output "load_balancer_ip" {
  description = "Point the domain at this address: an A record for var.domain."
  value       = google_compute_address.lb.address
}

output "certificate_dns_record" {
  description = "Add this CNAME so Google can issue the HTTPS certificate."
  value = {
    name = google_certificate_manager_dns_authorization.app.dns_resource_record[0].name
    type = google_certificate_manager_dns_authorization.app.dns_resource_record[0].type
    data = google_certificate_manager_dns_authorization.app.dns_resource_record[0].data
  }
}

output "image_repository" {
  description = "Push images here (the deploy workflow does)."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "github_variables" {
  description = "Set these as GitHub Actions variables (Settings → Secrets and variables → Actions → Variables)."
  value = {
    GCP_PROJECT_ID   = var.project_id
    GCP_REGION       = var.region
    GCP_WIF_PROVIDER = google_iam_workload_identity_pool_provider.github.name
    GCP_DEPLOYER_SA  = google_service_account.deployer.email
  }
}
