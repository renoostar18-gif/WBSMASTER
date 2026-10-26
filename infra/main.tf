# WBS Master on Google Cloud, Dammam (spec 8.2, 8.3). Everything that stores or processes
# customer data is regional: Cloud Run, Cloud SQL (and its backups), secrets, images, and a
# regional load balancer, so HTTPS also terminates in the region.

locals {
  name = "wbs-master"
  # whether SMTP is set is not secret, only its value is
  smtp = nonsensitive(var.smtp_url != "")
  apis = [
    "run.googleapis.com", "sqladmin.googleapis.com", "compute.googleapis.com", "servicenetworking.googleapis.com",
    "secretmanager.googleapis.com", "artifactregistry.googleapis.com", "cloudscheduler.googleapis.com",
    "certificatemanager.googleapis.com", "monitoring.googleapis.com", "iam.googleapis.com",
    "iamcredentials.googleapis.com", "sts.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each           = toset(local.apis)
  service            = each.value
  disable_on_destroy = false
}

# ---- network: private access to Cloud SQL, and the subnet Cloud Run sends traffic through ----

resource "google_compute_network" "vpc" {
  name                    = local.name
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "run" {
  name                     = "${local.name}-run"
  network                  = google_compute_network.vpc.id
  region                   = var.region
  ip_cidr_range            = "10.10.0.0/24"
  private_ip_google_access = true
}

# the regional load balancer needs its own proxy subnet
resource "google_compute_subnetwork" "proxy" {
  name          = "${local.name}-proxy"
  network       = google_compute_network.vpc.id
  region        = var.region
  ip_cidr_range = "10.10.8.0/23"
  purpose       = "REGIONAL_MANAGED_PROXY"
  role          = "ACTIVE"
}

resource "google_compute_global_address" "sql_range" {
  name          = "${local.name}-sql"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "sql" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.sql_range.name]
}

# ---- database ----

resource "google_sql_database_instance" "db" {
  name                = local.name
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = true
  depends_on          = [google_service_networking_connection.sql]

  settings {
    tier              = var.db_tier
    edition           = "ENTERPRISE"
    availability_type = var.db_high_availability ? "REGIONAL" : "ZONAL"
    disk_autoresize   = true
    disk_type         = "PD_SSD"

    ip_configuration {
      ipv4_enabled    = false # no public address
      private_network = google_compute_network.vpc.id
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      location                       = var.region # backups stay in the Kingdom
      start_time                     = "23:00"    # 02:00 Riyadh
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 30
      }
    }

    # Friday is the quietest day in the KSA working week
    maintenance_window {
      day  = 5
      hour = 0
    }

    insights_config {
      query_insights_enabled = true
    }

    database_flags {
      name  = "log_min_duration_statement"
      value = "1000"
    }
  }
}

resource "google_sql_database" "app" {
  name     = "wbs_master"
  instance = google_sql_database_instance.db.name
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "google_sql_user" "app" {
  name     = "wbs_master"
  instance = google_sql_database_instance.db.name
  password = random_password.db.result
}

# ---- secrets ----

resource "google_secret_manager_secret" "database_url" {
  secret_id = "${local.name}-database-url"
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = "postgres://${google_sql_user.app.name}:${random_password.db.result}@${google_sql_database_instance.db.private_ip_address}:5432/${google_sql_database.app.name}?sslmode=no-verify"
}

# encrypts secrets the app keeps in its database (SSO client secrets)
resource "random_password" "secret_key" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "secret_key" {
  secret_id = "${local.name}-secret-key"
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "secret_key" {
  secret      = google_secret_manager_secret.secret_key.id
  secret_data = random_password.secret_key.result
}

resource "google_secret_manager_secret_iam_member" "app_secret_key" {
  secret_id = google_secret_manager_secret.secret_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

resource "google_secret_manager_secret" "smtp_url" {
  count     = local.smtp ? 1 : 0
  secret_id = "${local.name}-smtp-url"
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

resource "google_secret_manager_secret_version" "smtp_url" {
  count       = local.smtp ? 1 : 0
  secret      = google_secret_manager_secret.smtp_url[0].id
  secret_data = var.smtp_url
}

# ---- images ----

resource "google_artifact_registry_repository" "images" {
  repository_id = local.name
  location      = var.region
  format        = "DOCKER"
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 20
    }
  }
  depends_on = [google_project_service.apis]
}

# ---- service accounts ----

resource "google_service_account" "app" {
  account_id   = "${local.name}-app"
  display_name = "WBS Master app (Cloud Run)"
}

resource "google_project_iam_member" "app" {
  for_each = toset(["roles/cloudsql.client", "roles/logging.logWriter", "roles/monitoring.metricWriter", "roles/cloudtrace.agent"])
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.app.email}"
}

resource "google_secret_manager_secret_iam_member" "app_database_url" {
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

resource "google_secret_manager_secret_iam_member" "app_smtp_url" {
  count     = local.smtp ? 1 : 0
  secret_id = google_secret_manager_secret.smtp_url[0].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

# ---- the app ----

locals {
  env = {
    NODE_ENV              = "production"
    APP_URL               = "https://${var.domain}"
    MAIL_FROM             = var.mail_from
    TRUST_PROXY           = "1"
    WEB_DIST              = "/app/web"
    WEBHOOK_ALLOW_PRIVATE = "0"
  }
}

resource "google_cloud_run_v2_service" "app" {
  name                = local.name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" # only through the load balancer and its firewall
  deletion_protection = true

  template {
    service_account                  = google_service_account.app.email
    timeout                          = "3600s" # live-update WebSockets stay open
    session_affinity                 = true
    max_instance_request_concurrency = 80

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = google_compute_network.vpc.id
        subnetwork = google_compute_subnetwork.run.id
      }
    }

    containers {
      image = var.image
      ports {
        container_port = 8080
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        cpu_idle = false # webhooks and live updates run between requests
      }
      dynamic "env" {
        for_each = local.env
        content {
          name  = env.key
          value = env.value
        }
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "SECRET_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.secret_key.secret_id
            version = "latest"
          }
        }
      }
      dynamic "env" {
        for_each = local.smtp ? [1] : []
        content {
          name = "SMTP_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.smtp_url[0].secret_id
              version = "latest"
            }
          }
        }
      }
      startup_probe {
        http_get {
          path = "/api/health"
        }
        period_seconds    = 5
        failure_threshold = 24
      }
      liveness_probe {
        http_get {
          path = "/api/health"
        }
        period_seconds = 30
      }
    }
  }

  lifecycle {
    # releases change the image through the deploy workflow
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [
    google_secret_manager_secret_version.database_url, google_secret_manager_secret_iam_member.app_database_url,
    google_secret_manager_secret_version.secret_key, google_secret_manager_secret_iam_member.app_secret_key,
  ]
}

# the daily notification digest (spec 7.1)
resource "google_cloud_run_v2_job" "digest" {
  name                = "${local.name}-digest"
  location            = var.region
  deletion_protection = false

  template {
    template {
      service_account = google_service_account.app.email
      max_retries     = 1
      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = google_compute_network.vpc.id
          subnetwork = google_compute_subnetwork.run.id
        }
      }
      containers {
        image   = var.image
        command = ["node", "dist/digest.js"]
        dynamic "env" {
          for_each = local.env
          content {
            name  = env.key
            value = env.value
          }
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "SECRET_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.secret_key.secret_id
              version = "latest"
            }
          }
        }
        dynamic "env" {
          for_each = local.smtp ? [1] : []
          content {
            name = "SMTP_URL"
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.smtp_url[0].secret_id
                version = "latest"
              }
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }
}

resource "google_service_account" "scheduler" {
  account_id   = "${local.name}-scheduler"
  display_name = "Runs the daily digest"
}

resource "google_cloud_run_v2_job_iam_member" "scheduler" {
  name     = google_cloud_run_v2_job.digest.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

resource "google_cloud_scheduler_job" "digest" {
  name      = "${local.name}-digest"
  region    = var.region
  schedule  = "0 5 * * *"
  time_zone = "Asia/Riyadh"
  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.digest.name}:run"
    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }
  depends_on = [google_project_service.apis]
}

# ---- regional HTTPS load balancer with a web application firewall ----

resource "google_compute_address" "lb" {
  name   = local.name
  region = var.region
}

resource "google_compute_region_network_endpoint_group" "app" {
  name                  = local.name
  region                = var.region
  network_endpoint_type = "SERVERLESS"
  cloud_run {
    service = google_cloud_run_v2_service.app.name
  }
}

resource "google_compute_region_security_policy" "waf" {
  name   = local.name
  region = var.region
  type   = "CLOUD_ARMOR"

  rules {
    priority    = 1000
    action      = "deny(403)"
    description = "SQL injection"
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('sqli-v33-stable', {'sensitivity': 1})"
      }
    }
  }
  rules {
    priority    = 1001
    action      = "deny(403)"
    description = "Cross-site scripting"
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('xss-v33-stable', {'sensitivity': 1})"
      }
    }
  }
  rules {
    priority    = 2000
    action      = "throttle"
    description = "At most 1200 requests a minute from one address (the app adds per-key and sign-in limits)"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 1200
        interval_sec = 60
      }
    }
  }
  rules {
    priority = 2147483647
    action   = "allow"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }
}

resource "google_compute_region_backend_service" "app" {
  provider              = google-beta
  name                  = local.name
  region                = var.region
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  timeout_sec           = 3600
  security_policy       = google_compute_region_security_policy.waf.id
  backend {
    group           = google_compute_region_network_endpoint_group.app.id
    balancing_mode  = "UTILIZATION"
    capacity_scaler = 1
  }
  log_config {
    enable      = true
    sample_rate = 1
  }
}

resource "google_compute_region_url_map" "app" {
  name            = local.name
  region          = var.region
  default_service = google_compute_region_backend_service.app.id
}

resource "google_certificate_manager_dns_authorization" "app" {
  name     = local.name
  location = var.region
  domain   = var.domain
  type     = "PER_PROJECT_RECORD"
}

resource "google_certificate_manager_certificate" "app" {
  name     = local.name
  location = var.region
  managed {
    domains            = [var.domain]
    dns_authorizations = [google_certificate_manager_dns_authorization.app.id]
  }
}

resource "google_compute_region_target_https_proxy" "app" {
  name                             = local.name
  region                           = var.region
  url_map                          = google_compute_region_url_map.app.id
  certificate_manager_certificates = [google_certificate_manager_certificate.app.id]
}

resource "google_compute_forwarding_rule" "https" {
  name                  = "${local.name}-https"
  region                = var.region
  ip_address            = google_compute_address.lb.id
  port_range            = "443"
  target                = google_compute_region_target_https_proxy.app.id
  load_balancing_scheme = "EXTERNAL_MANAGED"
  network               = google_compute_network.vpc.id
  depends_on            = [google_compute_subnetwork.proxy]
}

# plain http only redirects to https
resource "google_compute_region_url_map" "redirect" {
  name   = "${local.name}-redirect"
  region = var.region
  default_url_redirect {
    https_redirect = true
    strip_query    = false
  }
}

resource "google_compute_region_target_http_proxy" "redirect" {
  name    = "${local.name}-redirect"
  region  = var.region
  url_map = google_compute_region_url_map.redirect.id
}

resource "google_compute_forwarding_rule" "http" {
  name                  = "${local.name}-http"
  region                = var.region
  ip_address            = google_compute_address.lb.id
  port_range            = "80"
  target                = google_compute_region_target_http_proxy.redirect.id
  load_balancing_scheme = "EXTERNAL_MANAGED"
  network               = google_compute_network.vpc.id
  depends_on            = [google_compute_subnetwork.proxy]
}

# ---- monitoring: tell someone when the app is down ----

resource "google_monitoring_notification_channel" "email" {
  display_name = "WBS Master on-call"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
}

resource "google_monitoring_uptime_check_config" "app" {
  display_name = "WBS Master health"
  timeout      = "10s"
  period       = "60s"
  http_check {
    path         = "/api/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }
  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = var.domain
    }
  }
}

resource "google_monitoring_alert_policy" "down" {
  display_name = "WBS Master is down"
  combiner     = "OR"
  conditions {
    display_name = "Health check failing"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.app.uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.host"]
      }
    }
  }
  notification_channels = [google_monitoring_notification_channel.email.id]
}

# ---- keyless deploys from GitHub Actions (Workload Identity Federation) ----

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  depends_on                = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }
  # only this repository's main branch and release tags may deploy
  attribute_condition = "assertion.repository == '${var.github_repository}' && (assertion.ref == 'refs/heads/main' || assertion.ref.startsWith('refs/tags/v'))"
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "deployer" {
  account_id   = "${local.name}-deployer"
  display_name = "Deploys WBS Master from GitHub Actions"
}

resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

resource "google_project_iam_member" "deployer" {
  for_each = toset(["roles/run.developer", "roles/artifactregistry.writer"])
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

# the deployer may start revisions that run as the app's service account, nothing more
resource "google_service_account_iam_member" "deployer_acts_as_app" {
  service_account_id = google_service_account.app.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}
