#!/usr/bin/env bash
# Scheduled payment reconciliation caller (docs/ops/PAYMENT_RECONCILIATION_RUNBOOK.md).
#
# This repository is public, so Actions logs are public. The script prints only
# HTTP status codes and pass/fail. It never prints the secret or the response
# body (anomaly counts stay private; a red run means "look at admin/logs").
#
# Inputs (env): APP_URL, CRON_SECRET. Tunables for tests: WAKE_ATTEMPTS,
# WAKE_TIMEOUT, WAKE_SLEEP, RUN_TIMEOUT, RUN_ATTEMPTS, RUN_BACKOFF.
set -euo pipefail

: "${APP_URL:?APP_URL is not set}"
if [ -z "${CRON_SECRET:-}" ]; then echo "::error::CRON_SECRET secret is not set"; exit 1; fi
if [ "${#CRON_SECRET}" -lt 32 ]; then echo "::error::CRON_SECRET is shorter than 32 characters"; exit 1; fi
case "$APP_URL" in https://*|http://127.0.0.1:*) ;; *) echo "::error::APP_URL must be https"; exit 1 ;; esac

WAKE_ATTEMPTS="${WAKE_ATTEMPTS:-6}"
WAKE_TIMEOUT="${WAKE_TIMEOUT:-90}"
WAKE_SLEEP="${WAKE_SLEEP:-15}"
RUN_TIMEOUT="${RUN_TIMEOUT:-240}"
RUN_ATTEMPTS="${RUN_ATTEMPTS:-3}"
RUN_BACKOFF="${RUN_BACKOFF:-30}"

# 1. Wake the service. Render Free spins down after 15 idle minutes and a cold
#    start takes ~30-60 s; waking separately keeps that out of the run timeout.
code=000
for i in $(seq 1 "$WAKE_ATTEMPTS"); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time "$WAKE_TIMEOUT" "$APP_URL/api/health" || true)
  [ "$code" = "200" ] && break
  echo "health attempt $i/$WAKE_ATTEMPTS: HTTP $code"
  [ "$i" -lt "$WAKE_ATTEMPTS" ] && sleep "$WAKE_SLEEP"
done
if [ "$code" != "200" ]; then echo "::error::service did not become healthy (last HTTP $code)"; exit 1; fi
echo "service healthy"

# 2. Reconcile, with retries (FA-03). Safe to repeat: the endpoint runs one
#    reconciliation at a time (a call during a run answers 409 and changes
#    nothing) and every repair is idempotent (provider-confirmed state,
#    idempotency keys). Retried: network errors, timeouts, 409 (a previous
#    attempt is still running), 5xx. Not retried: 401/404 (configuration).
body="$(mktemp)"
trap 'rm -f "$body"' EXIT
code=000
for attempt in $(seq 1 "$RUN_ATTEMPTS"); do
  set +e
  code=$(curl -s -o "$body" -w '%{http_code}' --max-time "$RUN_TIMEOUT" \
    -H @<(printf 'Authorization: Bearer %s\n' "$CRON_SECRET") \
    "$APP_URL/api/cron/payments-reconcile")
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    if [ "$rc" -eq 28 ]; then echo "attempt $attempt/$RUN_ATTEMPTS: timed out after ${RUN_TIMEOUT}s"
    else echo "attempt $attempt/$RUN_ATTEMPTS: request failed (curl exit $rc)"; fi
    code=000
  else
    echo "attempt $attempt/$RUN_ATTEMPTS: HTTP $code"
  fi
  case "$code" in
    200|401|404) break ;;
  esac
  if [ "$attempt" -lt "$RUN_ATTEMPTS" ]; then sleep $(( RUN_BACKOFF * attempt )); fi
done
echo "reconcile endpoint: HTTP $code"
case "$code" in
  200) ;;
  409) echo "::warning::a reconciliation was still running after $RUN_ATTEMPTS attempts; it will finish on its own and the next run picks up the rest"; exit 0 ;;
  401) echo "::error::401: CRON_SECRET differs between GitHub and Render"; exit 1 ;;
  404) echo "::error::404: reconciliation is disabled on Render (CRON_SECRET / RECONCILE_ADMIN_USER_ID unset or not deployed)"; exit 1 ;;
  000) echo "::error::reconciliation did not answer after $RUN_ATTEMPTS attempts"; exit 1 ;;
  *)   echo "::error::reconciliation failed (HTTP $code) after $RUN_ATTEMPTS attempts; check Render logs, scope paymentReconcile"; exit 1 ;;
esac

# 3. 200: fail the run (without printing numbers) if anything still needs a human.
open=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(int(d["remaining"]) + int(d["repairFailures"]))' "$body" 2>/dev/null) \
  || { echo "::error::unexpected response shape"; exit 1; }
if [ "$open" -gt 0 ]; then
  echo "::error::payment anomalies need attention: run 'npm run payments:reconcile -- --admin <id>' (report only) and see the runbook"
  exit 1
fi
echo "reconciliation clean"
