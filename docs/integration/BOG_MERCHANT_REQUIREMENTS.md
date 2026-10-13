# Bank of Georgia: what we need from the bank

A checklist for the owner's conversation with BOG's e-commerce (Payment
Manager / online payments) team. It pairs with `BOG_PAYMENT_MANAGER_PLAN.md`.

**Never send or paste credentials into chat, email threads with third parties,
tickets or the repository.** Production credentials go straight into Vercel →
Project → Settings → Environment Variables → *Production*, marked **Sensitive**,
entered by the owner.

## A. What BOG will ask us for (prepare these)

Typical acquiring onboarding. BOG's exact list governs.

1. Legal entity details: company name, identification code (ს/კ), legal and
   actual address, director, and authorised signatory with ID.
2. A settlement account (IBAN). Usually it must be a BOG business account.
3. Business description and industry (gift greetings / digital goods), expected
   monthly volume and average ticket (10.00 GEL).
4. The website `https://qrapp.ge`, live and reviewable, with:
   - terms of service, privacy policy, and refund / cancellation policy;
   - delivery description (a digital greeting, activated instantly);
   - contact details and company details in the footer;
   - prices shown in GEL.

   These pages don't exist yet. They're a prerequisite to prepare, in KA and EN.
5. The technical contact for the integration.

## B. Credentials and technical information we need from BOG

| # | Item | Used for | Where it goes |
|---|---|---|---|
| B1 | **Production `client_id`** | OAuth token (Basic auth username) | Vercel Production: `BOG_CLIENT_ID` |
| B2 | **Production `client_secret`** (`secret_key`) | OAuth token (Basic auth password). The merchant can't change it. Ask how it's rotated if it leaks. | Vercel Production: `BOG_CLIENT_SECRET` (Sensitive) |
| B3 | **Test / sandbox `client_id` + `client_secret`**, if BOG offers a test environment | Preview / staging testing | Vercel Preview only |
| B4 | **API base URLs**: production and test, for both the payments API and the OAuth token endpoint | `BOG_API_BASE_URL`, `BOG_OAUTH_TOKEN_URL` | Vercel env (not secret) |
| B5 | **Callback signing public key** (PEM), its rotation policy, and how we're notified before rotation | Verifying `Callback-Signature` | `BOG_WEBHOOK_SIGNING_KEY` |
| B6 | Signature encoding (base64?), the exact signed bytes, and **a sample signed callback** for a test vector | Signature verification tests | Test fixtures |
| B7 | Callback delivery: retry count, intervals, timeout, expected response code, **source IP ranges** | Webhook design, optional IP allowlist | Code / config |
| B8 | Whether `callback_url` per order is enough or must be pre-registered/whitelisted (we'll use `https://qrapp.ge/api/webhooks/payments/BOG`) | Order creation | Code |
| B9 | Allowed `redirect_urls` domains, if restricted (`https://qrapp.ge`), and the **full list of hosts** BOG redirect links can use (e.g. `payment.bog.ge`) | Redirect allowlist | Code |
| B10 | **Payment methods activated** on our terminal: card (Visa/Mastercard/Amex?), Apple Pay, Google Pay, BOG P2P, loyalty | `payment_method` | Code |
| B11 | Terminal / POS `account.tag`, only if more than one GEL terminal | `config.account.tag` | Config |
| B12 | `Idempotency-Key` retention window, and whether deterministic UUID-v4-format keys are accepted | Retry safety (orders, refunds) | Code |
| B13 | Token lifetime (the documented `expires_in` example looks wrong) and API rate limits | Token cache, backoff | Code |
| B14 | **Test cards** and how to simulate success, decline, 3-D Secure failure and expiry | Testing | Test plan |

## C. Commercial and operational terms (get them in writing)

| # | Item | Why it matters |
|---|---|---|
| C1 | Merchant discount rate / fee per transaction (%, fixed), plus Apple/Google Pay and P2P fees if different | Platform margin on the 7.00 GEL share (decision B7 / D3) |
| C2 | Settlement frequency, settlement account, and whether fees are netted | Daily settlement reconciliation |
| C3 | **Business Manager** access (users and roles) and **settlement report** format (CSV/XLSX/API) | Reconciliation (§3.8 of the plan) |
| C4 | **Refunds:** time limit after payment, fees, whether a refund callback is always sent, typical completion time | Two-phase refund design |
| C5 | **Chargebacks / disputes:** how we're notified, response deadline, evidence format, fees, whether disputed funds are debited from settlement | Manual chargeback procedure |
| C6 | Fiscal / receipt obligations for online sales of digital goods, and whether VAT data must be sent in the basket | Basket `vat` fields, accounting |
| C7 | Requirements to keep the terminal active (minimum volume, PCI SAQ-A attestation for hosted-page integrations) | Compliance |
| C8 | Support contact for incidents (phone/email, hours) and an escalation path | `PILOT_LAUNCH_CHECKLIST.md` §18 |

## D. What we don't need

- Card data, PCI DSS scope beyond SAQ-A, or certificates. Card entry and 3-D Secure
  happen on BOG's hosted page.
- Any BOG SDK. The integration is plain HTTPS + JSON.
- Split-payment or partner IBANs. Not used at launch (decision B8).
