#!/usr/bin/env bash
# Set up (or update) WBS Master on Google Cloud, Dammam, from Cloud Shell. Nothing to install.
#
# In the Google Cloud console, open Cloud Shell (the >_ button, top right) and paste:
#   git clone https://github.com/renoostar18-gif/WBSMASTER.git ; cd WBSMASTER/infra && bash cloudshell-setup.sh
#
# It asks a few questions, then creates everything (15–20 minutes the first time). Running it again
# is safe: it only changes what is different, for example to add the email settings later.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ask() { # ask "question" default → answer
  local a
  read -r -p "$1${2:+ [$2]}: " a
  printf '%s' "${a:-$2}"
}

# ---- Terraform 1.6 or later ----
need_tf() { ! command -v terraform >/dev/null || [ "$(terraform version -json | python3 -c 'import sys,json; v=json.load(sys.stdin)["terraform_version"].split("."); print(int(v[0])*100+int(v[1]))')" -lt 106 ]; }
if need_tf; then
  say "Installing Terraform 1.9.8 for this session…"
  mkdir -p "$HOME/bin"
  curl -fsSL -o /tmp/tf.zip https://releases.hashicorp.com/terraform/1.9.8/terraform_1.9.8_linux_amd64.zip
  unzip -o -q /tmp/tf.zip -d "$HOME/bin"
  export PATH="$HOME/bin:$PATH"
fi

# ---- questions (answers are kept in terraform.tfvars for next time) ----
prev() { [ -f terraform.tfvars ] && sed -n "s/^$1 *= *\"\(.*\)\"/\1/p" terraform.tfvars | head -1 || true; }
say "WBS Master setup"
project=$(ask "Google Cloud project ID" "$(prev project_id || true)")
project=${project:-$(gcloud config get-value project 2>/dev/null)}
domain=$(ask "Web address for the app (for example app.yourdomain.com)" "$(prev domain)")
alert=$(ask "Email for outage alerts" "$(prev alert_email)")
prev_sender=$(prev mail_from | sed -n 's/.*<\(.*\)>.*/\1/p')
sender=$(ask "Email address that sends WBS Master's emails (Google Workspace; Enter to skip for now)" "$prev_sender")
if [ -n "$sender" ]; then
  read -r -s -p "App password for $sender (Enter to keep the one already saved): " app_pw; echo
fi
[ -n "$project" ] && [ -n "$domain" ] && [ -n "$alert" ] || { echo "Project, web address and alert email are needed."; exit 1; }

gcloud config set project "$project" >/dev/null
if [ "$(gcloud billing projects describe "$project" --format='value(billingEnabled)' 2>/dev/null)" != "True" ]; then
  echo "The project $project has no billing account linked. Link it (through CNTXT for the Dammam region), then run this again."
  exit 1
fi

# the answers above replace their lines; anything else in the file (VAT, company details) is kept
touch terraform.tfvars
sed -i -E '/^(project_id|domain|alert_email|mail_from) *=/d' terraform.tfvars
cat >> terraform.tfvars <<EOF
project_id  = "$project"
domain      = "$domain"
alert_email = "$alert"
mail_from   = "WBS Master <${sender:-no-reply@$domain}>"
EOF
# the sending account's app password goes to Secret Manager through Terraform; never into a file
if [ -n "${app_pw:-}" ]; then
  enc=$(python3 -c 'import sys,urllib.parse as u; print(u.quote(sys.argv[1], safe=""))' "$sender")
  pw=$(python3 -c 'import sys,urllib.parse as u; print(u.quote(sys.argv[1].replace(" ", ""), safe=""))' "$app_pw")
  export TF_VAR_smtp_url="smtps://$enc:$pw@smtp.gmail.com:465"
else
  # keep the email settings saved before, if any: read them back from Secret Manager
  TF_VAR_smtp_url=$(gcloud secrets versions access latest --secret=wbs-master-smtp-url 2>/dev/null || true)
  export TF_VAR_smtp_url
fi

# ---- the bucket that keeps Terraform's record of what exists ----
bucket="$project-tfstate"
gcloud services enable storage.googleapis.com cloudresourcemanager.googleapis.com serviceusage.googleapis.com >/dev/null
if ! gcloud storage buckets describe "gs://$bucket" >/dev/null 2>&1; then
  say "Creating the state bucket gs://$bucket in Dammam…"
  gcloud storage buckets create "gs://$bucket" --location=me-central2 --uniform-bucket-level-access
  gcloud storage buckets update "gs://$bucket" --versioning
fi

say "Checking what to create (this takes a minute)…"
terraform init -input=false -reconfigure -backend-config="bucket=$bucket" >/dev/null
terraform plan -input=false -out=tfplan
read -r -p "Create or update all of the above? Type yes: " ok
[ "$ok" = "yes" ] || { echo "Stopped; nothing was changed."; exit 1; }
terraform apply -input=false tfplan
rm -f tfplan

say "Done. Two things left:"
ip=$(terraform output -raw load_balancer_ip)
cname=$(terraform output -json certificate_dns_record | python3 -c 'import sys,json; r=json.load(sys.stdin); print("   CNAME  " + r["name"] + "  →  " + r["data"])')
cat <<EOF

1. Add these DNS records where you bought the domain:
   A      $domain  →  $ip
$cname
   The HTTPS certificate is issued within about an hour of adding them.

2. Copy everything between the lines below and send it to Claude, who sets up the releases:
------------------------------------------------------------------
$(terraform output -json github_variables)
------------------------------------------------------------------
EOF
