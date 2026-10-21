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
