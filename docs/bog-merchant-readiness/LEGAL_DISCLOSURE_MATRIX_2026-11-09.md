# Legal disclosure matrix (2026-11-09)

Which merchant details QR Starr must disclose, and on what authority. **This is a
research note, not legal advice, and it does not establish compliance.** A Georgian
lawyer must confirm it before the policies take effect. No owner values appear here
because this repository is public.

Primary texts were read on matsne.gov.ge on 2026-11-09, in Georgian where the wording
decides the point. English consolidated translations were used for the rest.

Status key: **Required** (the text of a law applies on its face), **Uncertain** (depends
on an interpretation a lawyer must confirm), **Scheme/BOG** (not Georgian law),
**Optional**.

## Release blockers

| # | Detail | Authority | Conflict |
|---|---|---|---|
| B1 | **Registry identification / personal number** | Law on Electronic Commerce, Art. 4(1)(d): the „საიდენტიფიკაციო ნომერი/პირადი ნომერი“ registered in the Registry of Entrepreneurs must be "permanently and easily accessible". Art. 2(c) covers natural persons, Art. 1(4) covers entrepreneurs registered under the Law on Entrepreneurs. The Competition Agency's 15.01.2024 notice also lists the identification number. No price threshold. | The owner has not approved publication, and for an individual entrepreneur this is a personal number. |
| B2 | **Registered legal address** | Law on the Protection of Consumer Rights, Art. 5(1)(b): the trader's identity and „მისამართის (იურიდიული მისამართის)“ before the contract. E-Commerce Art. 4(1)(b) requires „მისამართი“ (address, not qualified). | The owner has not approved publication. The public contact address is not a substitute for a field that names the legal address. |

Neither detail is shown on the site, and neither has been dropped silently: both stay
`required`, so `ops:check-merchant-info` fails and policies cannot read as in effect.

### Options

| Option | Resolves | Notes |
|---|---|---|
| A. Change the registered address at the Public Registry to the public contact address, then publish it | B2 | Only if the owner has the right to register that address. NAPR's fee page lists changes to registered data at 26 GEL (1 working day) or 75 GEL (same day); confirm the applicable row with NAPR. Bank documents must then be updated. |
| B. Owner approves publishing the current registered address | B2 | `MERCHANT_PUBLISH_LEGAL_ADDRESS=owner-approved`. |
| C. Owner approves publishing the number | B1 | `MERCHANT_PUBLISH_ID_CODE=owner-approved`. The only direct fix for B1 while trading as an individual entrepreneur. |
| D. Trade through an LLC | B1, B2 | A company code and commercial address replace personal data. Requires new registration and BOG onboarding. |
| E. Written opinion from a Georgian lawyer | Possibly narrows B2 | Could confirm whether the Art. 5(4) exemption applies, or whether showing the details only on the checkout screen meets both laws. Do not assume either. |

## Matrix

| Detail | Status | Authority | Site state |
|---|---|---|---|
| Registered name and legal form | Required | E-Commerce 4(1)(a); Consumer 5(1)(b) | Shown |
| Email and other contact details | Required | E-Commerce 4(1)(c); Consumer 5(1)(b) | Shown |
| Identification / personal number | Required | E-Commerce 4(1)(d) | **Withheld: B1** |
| Registered legal address | Required, subject to Consumer 5(4) | Consumer 5(1)(b) | **Withheld: B2** |
| Whether a contact address alone meets E-Commerce 4(1)(b) | Uncertain | "Address" is unqualified in the Georgian text | Contact address shown, labelled as such |
| Factual address if different from legal | Not required at this price | Consumer 10(1)(a), excluded by 10(3) for prices up to 30 GEL | Contact address shown voluntarily |
| Consumer 5(4) exemption (minor everyday transaction performed at once) | Uncertain | Not safe to assume for a 12-month digital service | Not relied on |
| Georgian-language information | Required | Consumer 5(1); E-Commerce Art. 10 | KA is primary |
| Price, all costs and taxes | Required | E-Commerce 4(2); Consumer Art. 5(1) | Price from the database; no extra charges |
| VAT status wording | Uncertain until verified | Owner-reported only | No VAT statement shown |
| Delivery and performance terms, complaint handling | Required | Consumer Art. 5(1) | `/delivery-and-refunds` |
| 14-day withdrawal, model form, consent to lose withdrawal | Uncertain | Chapter III (Arts. 10–15) is excluded by 10(3) up to 30 GEL. Any price above 30 GEL brings it back | Review note kept; no claim published |
| Steps to contract, storage, languages, error correction | Required | E-Commerce Art. 8 | Terms section added, review note kept |
| Order confirmation by electronic means | Required | E-Commerce Art. 9 | On-screen confirmation |
| Licence or permit number | Not applicable | E-Commerce 4(1)(e), "if any" | None |
| Controller identity and contact | Required | Personal Data Protection Art. 24(1)(a) | Shown |
| Purposes, legal basis, recipients, transfers, rights | Required | PDP Art. 24(1)(b),(f),(g),(i) | Mostly present. **Legal basis and transfer safeguards need review** |
| Retention period or criteria | Required | PDP Art. 24(1)(h) | **Gap:** the policy says nothing is deleted automatically; decision D1 is open |
| Refund and delivery policy, customer service contact | Scheme/BOG | Card-scheme practice; secondary sources only | Present |
| Merchant country at checkout | Scheme/BOG | Visa merchant-location guidance: on the checkout sequence, not a link | Added |
| BOG website checklist | Scheme/BOG | BOG publishes none that could be found (evidence of 2026-11-06; today's refetch of the FAQ URL returned no content, so this is not re-confirmed) | Ask BOG in writing |

## Enforcement

E-Commerce Art. 15–20: a recipient may complain to the Competition Agency, which can
order remedies. A fine applies when a decision is not followed, up to 2% of annual
turnover, doubled for a repeat within 12 months. Consumer Art. 34 is similar, with a
GEL 600 minimum. Art. 5(5) puts the burden of proving disclosure on the trader.

## Sources

- [Law on Electronic Commerce (KA)](https://matsne.gov.ge/ka/document/view/5825902), [EN PDF](https://matsne.gov.ge/en/document/download/5825902/0/en/pdf)
- [Law on the Protection of Consumer Rights (KA)](https://matsne.gov.ge/ka/document/view/5420598), [EN](https://matsne.gov.ge/en/document/view/5420598)
- [Law on Personal Data Protection (EN)](https://matsne.gov.ge/en/document/view/5827307)
- [Competition and Consumer Agency notice, 15.01.2024](https://gcca.gov.ge/index.php?m=370&news_id=1431&lng=eng)
- [NAPR fees and terms](https://napr.gov.ge/en/page/fees-and-terms)
- [Visa: providing the proper location of your merchant business](https://ae.review.visa.com/content/dam/VCOM/global/support-legal/documents/providing-the-proper-location-of-your-merchant-business-vbs.pdf)
- [BOG API documentation](https://api.bog.ge/docs/en/link-payment/introduction)
