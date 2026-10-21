# Merchant information: configuration and missing details

The public pages (footer, `/contact`, Terms §1, Privacy §1, and the support
contacts in every policy) show the merchant's registered details. They are
**environment configuration, not code**, so they are never committed to the
repository and can differ per environment (staging vs production).

## Variables

Set them in the hosting provider's environment settings (for example, Vercel →
Project → Settings → Environment Variables), per environment.

| Variable | Required | Format | Shown as |
|---|---|---|---|
| `MERCHANT_LEGAL_NAME_KA` | yes | Exactly as in the registry extract, in Georgian | Registered name (KA pages) |
| `MERCHANT_LEGAL_NAME_EN` | yes | Latin-script name as on registry/bank documents | Registered name (EN pages) |
| `MERCHANT_ENTITY_TYPE` | yes | `LLC`, `JSC`, `IE` or `OTHER` | Legal form, localised (e.g. შპს / LLC) |
| `MERCHANT_ID_CODE` | yes | 9 digits (company), or 11 (individual entrepreneur) | Identification code |
| `MERCHANT_LEGAL_ADDRESS_KA` | yes | Legal address in Georgian | Legal address (KA) |
| `MERCHANT_LEGAL_ADDRESS_EN` | yes | Legal address in English | Legal address (EN) |
| `MERCHANT_SUPPORT_EMAIL` | yes | Email address | Support email (mailto link) |
| `MERCHANT_PHONE` | yes | `+995 5XX XX XX XX` (spaces or dashes allowed) | Phone (tel link) |
| `MERCHANT_ACTUAL_ADDRESS_KA` / `_EN` | no | Only if different from the legal address | Actual address (omitted when unset) |
| `MERCHANT_SUPPORT_HOURS_KA` / `_EN` | no | Free text, e.g. "ორშ–პარ, 10:00–18:00" | Support hours (omitted when unset) |
| `MERCHANT_PRIVACY_EMAIL` | no | Email address | Privacy contact; falls back to the support email |
| `LEGAL_EFFECTIVE_DATE` | no | `YYYY-MM-DD` | "In effect from …" on the three policies. **Set only after legal approval.** |

## Previewing with fictional demo data

Before the real details exist, a preview or staging deployment can show the
pages complete with **fictional** details:

```sh
MERCHANT_PROFILE=demo
```

- The values are fixed in `src/lib/merchant/demo.ts` ("შპს ქიუარ სტარ დემო" /
  "QR Starr Demo LLC", ID 000000000, `demo@example.com`, `+995 555 00 00 00`, …).
  None of them identifies a real business.
- With the profile on, the real `MERCHANT_*` variables are **ignored**, so
  demo and real values never mix. The environment's real variables aren't
  read, changed or overwritten.
- Every page shows a "DEMO / სატესტო მონაცემები" notice at the top, in the
  footer and on the contact card, and every individual fictional value
  carries a DEMO tag.
- The demo profile sets **no effective date**, and the review and decision
  markers stay, so the policies remain drafts.
- **It is refused on production.** If `VERCEL_ENV=production`, or
  `NEXT_PUBLIC_APP_URL` is `https://qrapp.ge` / `https://www.qrapp.ge`, the
  profile is ignored, an error is logged, and the real variables, with their
  missing-information markers, apply as usual. A stray `MERCHANT_PROFILE`
  can't put fictional data on the live site.
- `npm run ops:check-merchant-info` reports the demo profile and exits 1:
  demo data never counts as merchant information.

Local preview: `npm run dev:demo`, then open http://localhost:3000/about.

On a hosted preview (for example Vercel): add `MERCHANT_PROFILE=demo` to the
**Preview** environment only, never to **Production**, and redeploy the
preview.

## Replacing the demo data with the real information

1. Collect the real details in the checklist below. Copy them exactly as they
   appear in the registry extract.
2. In the hosting provider's environment settings, set every **required**
   `MERCHANT_*` variable (table above) for each environment that should show
   real data. Staging and production are set separately.
3. In those environments, **remove** `MERCHANT_PROFILE` (or leave it unset).
   Production ignores it anyway, but it should not linger.
4. Redeploy, or restart the app, so the new environment is read.
5. Run `npm run ops:check-merchant-info` with that environment's variables.
   It must exit 0 with "All required merchant details are set" and no DEMO line.
6. Open `/contact` and the footer in both languages. No DEMO notice, no
   "Not yet published" marker; the email and phone links work.
7. Only after legal approval: remove the review and decision markers from
   `src/messages/site/*.json` (in a reviewed PR), then set
   `LEGAL_EFFECTIVE_DATE`. The draft banners disappear only when both are done.

`src/lib/merchant/demo.ts` can stay in the code base. It only ever applies
where `MERCHANT_PROFILE=demo` is set outside production.

## What happens when something is missing

- Nothing is invented. A required value that is unset, or set but invalid
  (bad email, phone, ID code, legal form or date), renders as a dashed
  **"Not yet published" / "ჯერ არ გამოქვეყნებულა"** marker. The invalid value
  itself is never displayed.
- Until every required value is valid, the footer shows one line ("Our
  registered company details are being finalised…") linking to `/contact`,
  instead of a block of markers.
- Each page that references a missing value shows the draft banner.

Check an environment:

```sh
npm run ops:check-merchant-info        # reads the current environment; exits 1 while anything required is missing
```

## Checklist for the owner

- [ ] Registered legal name in Georgian (`MERCHANT_LEGAL_NAME_KA`)
- [ ] Registered legal name in Latin script (`MERCHANT_LEGAL_NAME_EN`)
- [ ] Legal form (`MERCHANT_ENTITY_TYPE`)
- [ ] Identification code (`MERCHANT_ID_CODE`)
- [ ] Legal address, Georgian and English
- [ ] Actual address, if different
- [ ] Customer support email (a mailbox someone answers)
- [ ] Customer contact phone
- [ ] Support hours (recommended)
- [ ] Privacy request email, if not the support email
- [ ] The decisions in `BOG_WEBSITE_REQUIREMENTS.md` §2, then remove the corresponding markers from the copy (`src/messages/site/*.json`)
- [ ] Lawyer review of the ⚖️ provisions (§4 there), then remove those markers
- [ ] Native-speaker proofreading of the Georgian copy
- [ ] `LEGAL_EFFECTIVE_DATE`, once the policies are approved
- [ ] Card-scheme / Bank of Georgia marks, if BOG requires them (artwork from BOG)
