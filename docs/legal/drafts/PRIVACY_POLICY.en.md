> ⚠️ **DRAFT, NOT APPROVED. For owner and legal review only. Not legal advice. Do not publish.**
> Placeholders `[[…]]` must be resolved first. See `README.md` §3. Facts in this
> draft were checked against the code on 2026-10-16. If the product changes,
> this text must change too.

# QR Starr: Privacy Policy

Last updated: [[date of approval]]

[[COMPANY LEGAL NAME]] ("we") is the controller of the personal data described
here, under the Law of Georgia on Personal Data Protection. Contact:
[[privacy email]], [[address]]. [[LEGAL: is a personal data protection officer
required? If so, add their contact.]]

## 1. Whose data, what data, and why

| Who | Data | Purpose | Legal basis [[LEGAL: confirm each]] |
|---|---|---|---|
| **Sender** (creates the greeting) | Message, photos, video, voice recording and chosen design; the people and voices in them | To build the greeting and show it to whoever opens the card | Performing the contract you request |
| Sender | Payment record: amount, currency, time, Bank of Georgia's order reference, card brand and **last 4 digits** (never the full card number) | Payment, refunds, accounting, disputes | Contract; legal obligation (accounting) |
| Sender | A random editing key kept in a cookie on your device | So only you can edit the greeting before paying | Contract |
| **Recipient** (opens the card) | When the greeting is opened (the time, linked to the card, **not** to you as a person) | Delivery confirmation; evidence in a payment dispute; aggregate statistics | Legitimate interest |
| **Everyone** | IP address, browser type, request logs | Security, abuse prevention (rate limiting), troubleshooting | Legitimate interest |
| **Partners and admins** | Name, email, login data, actions in the dashboard (audit log) | Running partner accounts, commission and payouts, security | Contract; legitimate interest |
| Anyone who contacts us | Your message and contact details | Answering you | Legitimate interest / your request |

**People shown in a greeting.** If you add photos, video or voice of other
people, you are responsible for having their permission (Terms §5).

## 2. Who can see a greeting

- **Anyone holding the activated card or its link** can open it. There's no
  password: the card is the key.
- **Partner shops can't see greetings.** They only see whether a card has been
  used, never its content.
- **Our staff** see a greeting's content only to handle a report of abuse,
  a legal request, or your own support request.

## 3. Who processes data for us

| Provider | Role | Location |
|---|---|---|
| [[Vercel Inc.]] | Website hosting | Servers in Frankfurt, Germany; US company |
| [[Supabase Inc.]] | Database, file storage, partner login | Frankfurt, Germany; US company |
| **Bank of Georgia** | Card payments (as an independent controller under its own policy) | Georgia |
| [[Resend]] | Account emails to partners and admins only | [[confirm]]; US company |

[[LEGAL: the legal basis for transfers to these providers (US companies, EU
hosting) under the Law of Georgia on Personal Data Protection, and data
processing agreements with each.]] We do not sell personal data and we do not
use advertising or third-party tracking.

## 4. Cookies and local storage

We only use what the service needs. There are no advertising or analytics
cookies, so we don't ask for consent to them. [[LEGAL: confirm that no cookie
banner is required for strictly necessary cookies.]]

| Name | Purpose | Lifetime |
|---|---|---|
| `NEXT_LOCALE` | Remembers your language (ka/en) | 1 year |
| `qr_edit_<id>` | Your private editing access to a greeting you're creating; afterwards, shows you the "sent by you" note | 14 days |
| `qrs:message:<id>` (local storage, not a cookie) | Keeps your unsent message on your own device if the page reloads; deleted once saved | Until saved |
| Login cookies, `active_partner_id` | Partner and admin accounts only | Session / 90 days |

## 5. How long we keep data

[[DECISION D1: fill in. Today nothing is deleted automatically. Proposed
starting point for the lawyer:]]

- Activated greetings and their media: [[N years]] after activation, or until
  you ask us to delete them.
- Unpaid drafts: [[N days]] after the last change.
- Payment and order records: as long as accounting and tax law requires
  ([[N years]]).
- Security logs: [[N days]].

## 6. Your rights

Under Georgian law you can ask us to:

- give you access to your data or a copy of it;
- correct it;
- delete it;
- restrict or object to its use;
- transfer it, where that applies.

You can also withdraw any consent you gave. Write to [[privacy email]] with the
card's code, so we can find the greeting without asking for more personal
data. We answer within [[the statutory deadline — LEGAL]].

**Deleting an activated greeting** makes it unavailable on the card for
everyone. Payment records are kept as long as the law requires.

You can complain to the **Personal Data Protection Service of Georgia**
([[contact details]]).

## 7. Security

- All traffic is encrypted (HTTPS).
- Media files are stored privately and served only through short-lived signed links.
- Access inside the database is restricted per role.
- We never receive full card details.

If a breach is likely to affect you, we notify the Personal Data Protection
Service within 72 hours of detecting it, and inform you where the law requires.

## 8. Children

The service isn't directed at children under [[16 — DECISION D2]]. A
greeting may of course be *for* a child.

## 9. Changes

We will post changes here with a new date. [[LEGAL: whether material changes
require notice.]]
