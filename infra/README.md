# Hosting WBS Master on Google Cloud, Dammam (me-central2)

This folder creates the production setup with Terraform. Everything that stores or processes customer
data stays in the Dammam region:
- the app on Cloud Run;
- the database on Cloud SQL, including its backups;
- the secrets and the container images;
- the HTTPS load balancer, so encrypted traffic is also opened in the Kingdom.

```
users ──https──▶ regional load balancer + firewall (Cloud Armor) ──▶ Cloud Run "wbs-master"
                                                                     │  API, web app, live updates, webhooks
                                                                     ▼
                                                Cloud SQL Postgres 16 (private address, standby, backups)
Cloud Scheduler 05:00 Riyadh ──▶ Cloud Run job "wbs-master-digest" (daily notification emails)
GitHub Actions (v* tag) ──keyless──▶ Artifact Registry ──▶ new Cloud Run revision
```

## What you need first

1. **A Google Cloud organisation and billing account for KSA.** Google Cloud in the Kingdom is sold through
   CNTXT. Create a project, for example `wbs-master-prod`, and link the billing account.
2. **A domain**, for example `app.wbsmaster.sa`, where you can add DNS records.
3. **An email address for alerts**, and when you have chosen one, an email provider with SMTP (optional at
   first; without it, notification emails are only written to the log).
4. On your computer: the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) and
   [Terraform](https://developer.hashicorp.com/terraform/install) 1.6 or later.

## Set it up (about an hour, most of it waiting)

```sh
gcloud auth login
gcloud auth application-default login
gcloud config set project wbs-master-prod

# 1. a bucket for Terraform's state, in the region, with versioning
gcloud storage buckets create gs://wbs-master-prod-tfstate --location=me-central2 --uniform-bucket-level-access
gcloud storage buckets update gs://wbs-master-prod-tfstate --versioning

# 2. settings
cd infra
cp terraform.tfvars.example terraform.tfvars   # edit: project_id, domain, alert_email, mail_from
export TF_VAR_smtp_url='smtps://user:password@smtp.example.sa:465'   # optional, keeps it out of files

# 3. create everything (the first run takes 15–20 minutes, mostly the database)
terraform init -backend-config="bucket=wbs-master-prod-tfstate"
terraform apply
```

Then:

4. **DNS.** Add the two records Terraform prints:
   - an `A` record for your domain pointing at `load_balancer_ip`;
   - the `CNAME` in `certificate_dns_record`.

   The HTTPS certificate is issued within about an hour of adding them.
5. **GitHub.** In the repository, open Settings → Secrets and variables → Actions → Variables, and add
   the four values from `terraform output github_variables`. Under Settings → Environments, create
   `production`, and add yourself as a required reviewer so each release waits for your approval.
6. **First release.** Push a tag (`git tag v1.0.0 && git push origin v1.0.0`) or run the *Deploy* workflow
   by hand. It builds the image, pushes it, and rolls it out. The app applies database migrations as
   it starts. Open `https://<your domain>`, create the first account, and you are its organisation owner.

## Running it

| Task | How |
| --- | --- |
| Release | Tag `v1.2.3` and approve the *Deploy* run. Cloud Run keeps earlier revisions; roll back with `gcloud run services update-traffic wbs-master --to-revisions=<rev>=100 --region=me-central2`. |
| Change size or settings | Edit `terraform.tfvars` (for example `min_instances = 2`, `db_tier`), then `terraform apply`. |
| Email | Set `TF_VAR_smtp_url` and `terraform apply`; new instances pick it up. |
| Restore the database | Cloud SQL → Backups (daily, kept 30 days), or point-in-time recovery to any moment in the last 7 days. Restore into a new instance first and check it. |
| Logs and errors | Cloud Logging, filtered to the `wbs-master` Cloud Run service. Load balancer logs show blocked requests. |
| Alerts | Email to `alert_email` when the health check fails from several places for 5 minutes. |

## Security choices

- **Database:** no public address; connections are encrypted. The password is generated and kept in
  Secret Manager (and in the Terraform state, which is why the state bucket must stay private).
- **Cloud Run:** accepts traffic only from the load balancer, so the firewall rules always apply.
  They block SQL injection and cross-site scripting patterns, and allow at most 1,200 requests a
  minute per address. The app adds its own limits per API key and for sign-in.
- **Deploys:** use keyless sign-in from GitHub, limited to this repository's `main` branch and `v*`
  tags. The deploy account can release new revisions, and nothing more.
- **Webhooks:** may only call public https addresses (`WEBHOOK_ALLOW_PRIVATE=0`).
- **Several instances:** they share live updates through the database (Postgres LISTEN/NOTIFY), and
  migrations take a lock, so scaling out needs no extra service.

## Costs

The database is the largest cost, and high availability doubles it. Turn `db_high_availability` off for
a staging copy. Cloud Run with one warm instance, the load balancer and the firewall come next. Use the
Google Cloud pricing calculator with region `me-central2` for current prices.
