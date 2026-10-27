# Putting WBS Master online: step by step

No technical background needed. You do the steps that need your identity or payment; one script does the
rest. Allow an afternoon, most of it waiting.

## 1. A domain and email (Google Workspace)

1. Choose a web address. A `.com` address needs no Saudi documents; a `.sa` address needs
   Saudi registration papers, so it can come later.
2. Sign up for [Google Workspace](https://workspace.google.com) (Business Starter is enough). During
   sign-up you can buy the domain directly, or use one you bought elsewhere.
3. In Workspace, create a mailbox for sending, for example `no-reply@yourdomain.com`.
4. Sign in as that mailbox. Turn on 2-Step Verification
   ([myaccount.google.com/security](https://myaccount.google.com/security)). Then create an **app
   password** ([myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)) named
   "WBS Master". Keep the 16 letters for step 3. If the page says app passwords are not available, allow
   them in the Workspace admin console's security settings, then try again.

## 2. Google Cloud in the Dammam region (through CNTXT)

Google sells its Saudi region through CNTXT. Without a commercial registration you can start as an
individual and move to the company account later.

1. Go to [cloud.cntxt.com](https://cloud.cntxt.com) and sign up with the same Google account.
2. Follow CNTXT's steps to set up billing, then create a project named `wbs-master-prod` and link it to
   that billing account. Write down the **project ID** shown (it may have extra numbers).

## 3. Run the setup script

1. Open [console.cloud.google.com](https://console.cloud.google.com) and pick the project at the top.
2. Click the **>_** button (top right) to open Cloud Shell: a terminal in your browser.
3. Paste this line and press Enter:

   ```
   git clone https://github.com/renoostar18-gif/WBSMASTER.git ; cd WBSMASTER/infra && bash cloudshell-setup.sh
   ```

4. Answer its questions: the project ID, the web address (for example `app.yourdomain.com`), an email for
   outage alerts, the sending mailbox and its app password.
5. It shows what it will create; type `yes`. The first run takes 15–20 minutes.

At the end it prints:
- **two DNS records.** Add them where you manage the domain (in Workspace: Admin console → Domains →
  Manage domains → DNS). The HTTPS certificate arrives within about an hour.
- **a block of text.** Send it to Claude, who connects the GitHub releases and puts the app online.

To change something later (for example the mailbox), run the same line again. If Cloud Shell says the
folder already exists, use `cd WBSMASTER/infra && git pull && bash cloudshell-setup.sh`.

## 4. Later

- **Payments:** open a Moyasar account once the company has its registration.
- **VAT** is switched on (15% added to prices). Only a VAT-registered seller may charge VAT. Register with
  ZATCA, or switch it off (`vat_enabled = false` in `terraform.tfvars`, then run the script again),
  before taking real payments.
- **Company details** for invoices (address, CR number, VAT number): see `terraform.tfvars.example`.
