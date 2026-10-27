// Terms of Service and Privacy Policy, English. DRAFT: to be reviewed by a qualified lawyer before publication.
// Text in square brackets (<Ph>) is a placeholder the owner must fill in. Keep legal.ar.tsx in step.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface LegalSection { id: string; h: string; body: ReactNode }
export interface LegalDoc { title: string; intro: ReactNode; sections: LegalSection[] }
export interface LegalTexts { terms: LegalDoc; privacy: LegalDoc }

/** A placeholder still to be filled in, highlighted so it is not missed. */
export const Ph = ({ children }: { children: ReactNode }) => <mark className="ph">[{children}]</mark>;

export const LEGAL_EN: LegalTexts = {
  terms: {
    title: 'Terms of Service',
    intro: (
      <>
        <p>
          These terms apply to WBS Master, an online service for planning projects (the “Service”), provided by Raysha
          (“Raysha”, “we”, “us”), commercial registration <Ph>CR number</Ph>, <Ph>Company address</Ph>.
        </p>
        <p>
          By creating an account or using the Service, you agree to these terms. If you use the Service for an organisation,
          you confirm that you may accept these terms on its behalf. Our <Link to="/privacy">Privacy Policy</Link> explains how we
          handle personal data.
        </p>
      </>
    ),
    sections: [
      {
        id: 'accounts', h: 'Accounts',
        body: (
          <ul>
            <li>You need an account to use the Service. Give accurate details and keep them up to date.</li>
            <li>An account is for one person. Keep your password secret; you are responsible for what is done with your account.</li>
            <li>If you think someone else has used your account, tell us straight away at <Ph>support email</Ph>.</li>
          </ul>
        ),
      },
      {
        id: 'organisations', h: 'Organisations and roles',
        body: (
          <>
            <p>
              Work in WBS Master happens inside an organisation. The organisation is our customer. The person who creates it
              becomes its owner.
            </p>
            <ul>
              <li>Owners and administrators invite members and guests, choose their roles, manage settings and billing, and can remove people.</li>
              <li>Members work on the organisation’s projects. Guests see only the projects they are invited to.</li>
              <li>The organisation is responsible for who it gives access to, and for what its members and guests do in the Service.</li>
            </ul>
          </>
        ),
      },
      {
        id: 'use', h: 'Acceptable use',
        body: (
          <>
            <p>You must not:</p>
            <ul>
              <li>use the Service to break the law or anyone else’s rights;</li>
              <li>upload malicious code, or try to get into accounts, organisations or data that are not yours;</li>
              <li>try to get around plan limits or security measures, or test the Service’s security without our written permission;</li>
              <li>overload the Service, for example with automated access outside the API and its reasonable limits;</li>
              <li>resell the Service without an agreement with us.</li>
            </ul>
            <p>We may remove content or limit access that breaks these rules.</p>
          </>
        ),
      },
      {
        id: 'data', h: 'Your data',
        body: (
          <>
            <p>
              “Customer data” means what your organisation and its people put into the Service: projects, items, dates,
              comments, attachments and similar content.
            </p>
            <ul>
              <li>Your organisation owns its customer data. We claim no ownership of it.</li>
              <li>You allow us to store, copy, process and display customer data only to provide, secure and support the Service, and as your organisation instructs.</li>
              <li>We do not sell customer data and do not use it for advertising.</li>
              <li>You are responsible for having the right to put customer data into the Service.</li>
            </ul>
          </>
        ),
      },
      {
        id: 'billing', h: 'Plans, trials and payment',
        body: (
          <ul>
            <li>The plans (Free, Team and Business), what each includes and their prices are shown on our <Link to="/pricing">pricing page</Link>.</li>
            <li>Paid plans are priced per user per month. Members of the organisation count as users; guests are free.</li>
            <li>Each organisation can try Team or Business free for 14 days, once. At the end of the trial it returns to the Free plan unless you pay.</li>
            <li>You pay in advance for a month or a year, by mada, Visa, Mastercard or Apple Pay, through our payment provider Moyasar. We do not store card numbers.</li>
            <li>
              Nothing renews automatically. We remind you by email before a paid period ends. After it ends, the plan carries on for a
              short grace period (currently 7 days) so you can renew; after that the organisation moves to the Free plan.
            </li>
            <li>If we change prices, the new prices apply from the next period you pay for, not to a period already paid.</li>
            <li>Refunds: <Ph>Refund policy to be confirmed</Ph>.</li>
          </ul>
        ),
      },
      {
        id: 'vat', h: 'VAT',
        body: (
          <p>
            Prices exclude value added tax. VAT at the current Saudi rate (15%) is added at checkout and shown on your invoice.
            Our VAT registration number is <Ph>VAT number</Ph>.
          </p>
        ),
      },
      {
        id: 'changing-plans', h: 'Changing plans',
        body: (
          <p>
            You can upgrade at any time. Moving to a smaller plan, or not renewing, never deletes data: projects over the
            smaller plan’s limits become read-only until you upgrade again or archive some projects.
          </p>
        ),
      },
      {
        id: 'availability', h: 'Availability and support',
        body: (
          <>
            <p>
              We work to keep the Service available and to fix problems quickly, but we do not guarantee that it will always be
              available or free of errors. The Business plan includes an uptime commitment, set out in a separate service level
              agreement to be published <Ph>link to the SLA</Ph>. No other plan includes an uptime commitment.
            </p>
            <p>The support included with each plan is shown on the pricing page.</p>
          </>
        ),
      },
      {
        id: 'suspension', h: 'Suspension and termination',
        body: (
          <>
            <p>You can stop using the Service at any time, and an owner can ask us to delete the organisation.</p>
            <p>
              We may suspend or close an account or organisation that seriously or repeatedly breaks these terms, or where the
              law requires it. Where reasonable, we will tell you first, give you a chance to put things right, and let you
              export your data.
            </p>
          </>
        ),
      },
      {
        id: 'export', h: 'Export and deletion',
        body: (
          <ul>
            <li>You can export your projects to Excel at any time. On Business, you can also export the activity history.</li>
            <li>When an organisation is deleted, its data is removed after a 30-day waiting period.</li>
            <li>We keep invoices and billing records for as long as the law requires.</li>
          </ul>
        ),
      },
      {
        id: 'liability', h: 'Limitation of liability',
        body: (
          <p>
            <Ph>Limitation of liability and disclaimers, to be drafted by counsel under Saudi law (for example: a cap on total
            liability, exclusion of indirect losses, and the exceptions the law requires)</Ph>
          </p>
        ),
      },
      {
        id: 'law', h: 'Governing law',
        body: (
          <p>
            These terms are governed by the laws of the Kingdom of Saudi Arabia. Disputes are settled by the competent courts
            of the Kingdom of Saudi Arabia <Ph>city or forum, if any</Ph>.
          </p>
        ),
      },
      {
        id: 'changes', h: 'Changes to these terms',
        body: (
          <p>
            We may update these terms. We will publish the new version on this page with its date and, for important changes,
            tell organisation owners by email or in the app <Ph>notice period</Ph> before they take effect. If you keep using
            the Service after that, the new terms apply.
          </p>
        ),
      },
      {
        id: 'language', h: 'Language',
        body: <p>These terms are published in Arabic and English. <Ph>Which version prevails if they differ</Ph>.</p>,
      },
      {
        id: 'contact', h: 'Contact',
        body: <p>Raysha, <Ph>Company address</Ph>. Email: <Ph>support email</Ph>. Website: <Ph>domain</Ph>.</p>,
      },
    ],
  },

  privacy: {
    title: 'Privacy Policy',
    intro: (
      <>
        <p>
          Raysha (“we”, “us”), commercial registration <Ph>CR number</Ph>, <Ph>Company address</Ph>, provides WBS Master.
          This policy explains what personal data we handle, why, where it is kept, and your rights under the Saudi Personal
          Data Protection Law (PDPL), which is overseen by the Saudi Data and AI Authority (SDAIA).
        </p>
      </>
    ),
    sections: [
      {
        id: 'roles', h: 'Who is responsible for your data',
        body: (
          <ul>
            <li>
              <b>Project data.</b> Your organisation decides what goes into its projects (items, dates, owners, comments and
              activity). For this data your organisation is the controller, and we process it on its behalf and following its
              instructions. Questions about project data are best sent to your organisation’s administrator first; we will help them.
            </li>
            <li>
              <b>Account and billing data.</b> For your account (name, email, sign-in) and for billing, Raysha is the controller.
            </li>
          </ul>
        ),
      },
      {
        id: 'collect', h: 'What we collect',
        body: (
          <ul>
            <li><b>Account:</b> your name, email address, password (stored only as a one-way hash, never in readable form), language and theme, and the organisations and roles you have.</li>
            <li><b>Company sign-in:</b> if your organisation uses single sign-on, the name, email address and account identifier that Microsoft Entra ID or Google sends us.</li>
            <li><b>Project data:</b> what you and your colleagues enter, comments and @mentions, notifications, and the activity history (who changed what, and when).</li>
            <li><b>Billing:</b> organisation name, plan, number of users, invoices, and the payment status and reference from Moyasar. Card details go straight to Moyasar; we do not receive or store card numbers.</li>
            <li><b>Technical:</b> IP address, browser details and request records in server logs, used for security and troubleshooting.</li>
          </ul>
        ),
      },
      {
        id: 'use', h: 'Why we use it',
        body: (
          <>
            <ul>
              <li>to provide the Service you or your organisation signed up for;</li>
              <li>to keep the Service and your data secure and to prevent abuse;</li>
              <li>to take payments and issue invoices, as tax law requires;</li>
              <li>to send emails the Service needs: invitations, notifications about your work, and billing reminders;</li>
              <li>to answer your questions and support requests;</li>
              <li>to meet our legal obligations.</li>
            </ul>
            <p>We do not sell personal data, and we do not use it for advertising.</p>
          </>
        ),
      },
      {
        id: 'cookies', h: 'Cookies and storage in your browser',
        body: (
          <ul>
            <li>One essential cookie, <code>wbs_session</code>, keeps you signed in. It cannot be read by scripts on the page (httpOnly).</li>
            <li>Your browser’s local storage remembers your language and theme.</li>
            <li>We use no analytics, no advertising trackers and no third-party cookies.</li>
          </ul>
        ),
      },
      {
        id: 'where', h: 'Where your data is kept',
        body: (
          <>
            <p>
              Your data is stored in Saudi Arabia, on Google Cloud in the Dammam region (me-central2), provided through CNTXT.
            </p>
            <p><Ph>To be confirmed: whether any service provider below transfers personal data outside the Kingdom, and on what basis</Ph></p>
          </>
        ),
      },
      {
        id: 'share', h: 'Who we share it with',
        body: (
          <>
            <p>We use these service providers, who process data for us under contract:</p>
            <ul>
              <li><b>Google Cloud</b>, through CNTXT: hosting and storage.</li>
              <li><b>Google Workspace</b>: sending emails.</li>
              <li><b>Moyasar</b>: taking payments.</li>
            </ul>
            <p>
              Inside your organisation, other people can see your name and the work you do in shared projects. We disclose
              data to authorities only when the law requires it.
            </p>
          </>
        ),
      },
      {
        id: 'retention', h: 'How long we keep it',
        body: (
          <ul>
            <li>Project data is kept while your organisation exists.</li>
            <li>Activity history is kept for as long as your plan includes: 30 days on Free, 1 year on Team, and without a time limit on Business.</li>
            <li>When an organisation is deleted, its data is removed after a 30-day waiting period.</li>
            <li>Account data is kept until you delete your account <Ph>account deletion process and timing</Ph>.</li>
            <li>Invoices and billing records are kept for as long as the law requires <Ph>period</Ph>.</li>
            <li>Server logs are kept for <Ph>log retention period</Ph>.</li>
          </ul>
        ),
      },
      {
        id: 'security', h: 'Security',
        body: (
          <p>
            Data is encrypted in transit (HTTPS) and at rest, passwords are stored only as one-way hashes, and access to
            production systems is restricted. If a personal data breach happens, we will notify SDAIA and the people affected
            as the PDPL requires.
          </p>
        ),
      },
      {
        id: 'rights', h: 'Your rights',
        body: (
          <>
            <p>Under the PDPL you have the right to:</p>
            <ul>
              <li>be told how your personal data is collected and used (this policy);</li>
              <li>get access to your personal data and a copy of it in a readable format;</li>
              <li>have inaccurate or incomplete data corrected;</li>
              <li>have your data deleted when it is no longer needed, unless the law requires us to keep it;</li>
              <li>withdraw your consent where we rely on it;</li>
              <li>complain to SDAIA.</li>
            </ul>
            <p>
              You can change your language and theme yourself at any time. For anything else, write to <Ph>privacy
              email</Ph>. For project data, please contact your organisation first. We will reply within <Ph>response time</Ph>.
            </p>
          </>
        ),
      },
      {
        id: 'changes', h: 'Changes to this policy',
        body: (
          <p>
            We will publish any update on this page with its date and, for important changes, tell organisation owners by
            email or in the app before they take effect.
          </p>
        ),
      },
      {
        id: 'contact', h: 'Contact',
        body: <p>Raysha, <Ph>Company address</Ph>. Privacy questions: <Ph>privacy email</Ph>. Website: <Ph>domain</Ph>.</p>,
      },
    ],
  },
};
