# Payment reconciliation schedule on Render (prepared 2026-11-06; NOT applied)

`/api/cron/payments-reconcile` exists in production code but **never runs on Render**: the only schedule is in `vercel.json`, and the route answers **404** until both `CRON_SECRET` and `RECONCILE_ADMIN_USER_ID` are set (then **401** without `Authorization: Bearer $CRON_SECRET`, constant-time compare).

`render.yaml` intentionally stays without `CRON_SECRET` while checkout is disabled (`verify:low-cost-hosting` asserts this). Apply the steps below **only when the payment go-live is approved**, in the same change as the BOG variables.

## Steps (owner, Render dashboard)

1. **Web service `qr-starr` → Environment**
   - `CRON_SECRET`: a random value of at least 32 characters. Mark it **Sensitive**; never paste it into chat or logs.
   - `RECONCILE_ADMIN_USER_ID`: the auth user id of a real platform admin (a row in `admin_users`) that the job acts as. **Not** the demo admin.
2. **New → Cron Job** `qr-starr-payments-reconcile`
   - region Frankfurt;
   - schedule `15 * * * *` (hourly: pending payments become STALE after 30 min, BOG refunds after 1 h);
   - command: `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://qrapp.ge/api/cron/payments-reconcile`;
   - env `CRON_SECRET`: the same value as step 1.

   Render Cron Jobs are billed per run-minute. An external scheduler that sends the same request is an acceptable alternative.
3. **Check:**
   - without the header → 401;
   - the job's log shows `{"anomalies":N,"repaired":M}`;
   - in the web service logs, `scope: "paymentReconcile"` warnings mean money and records disagree. Route them to an alert (see PRODUCTION_RELEASE_CHECKLIST).
