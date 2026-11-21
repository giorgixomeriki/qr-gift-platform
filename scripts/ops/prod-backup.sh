#!/usr/bin/env bash
# Verified full database backup before a production migration (BOG release Phase B).
#
#   BACKUP_DATABASE_URL=<migrations-owner URL>  scripts/ops/prod-backup.sh <label>
#
# Steps (read-only against the source; never prints the URL or row data):
#  1. Fingerprint the source (scripts/ops/backup-fingerprint.sql): schema
#     (columns, constraints, indexes, policies, RLS, triggers, functions,
#     enums, grants), exact row count + full-content md5 of every public /
#     drizzle table, auth/storage hashes, per-status money totals, ledger.
#  2. pg_dump --format=custom of the whole database from a local Postgres 17
#     container (PGDUMP_CONTAINER, default: first running supabase_db_*).
#  3. Fingerprint the source again: anything that differs pre/post was
#     written by live traffic during the dump ("volatile").
#  4. sha256 + TOC of the dump.
#  5. Restore WITH privileges (owner not restored) into a throwaway database in
#     that container, fingerprint it, and compare:
#       - every line stable on the source must be identical in the restore;
#       - volatile lines are reported; any volatile money:/ledger:/schema: line fails.
#  6. Drop the throwaway database (KEEP_RESTORE=1 keeps it and prints its name).
# Output: <out>/qrapp-prod-full-<UTC stamp>-<label>.{dump,sha256,toc,err,
#   fp-pre,fp-post,fp-restore,restore-errors,verify}. Exit 0 only on MATCH.
#
# The URL must be the migrations owner (postgres.*), not app_runtime: RLS
# makes app_runtime's dump incomplete.
set -euo pipefail
umask 077

label=${1:?usage: prod-backup.sh <label>}
[[ $label =~ ^[a-z0-9-]+$ ]] || { echo "label: lowercase letters, digits, dashes" >&2; exit 2; }
url=${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is required (migrations-owner URL)}
case $url in *app_runtime*) echo "refusing: app_runtime URL gives an RLS-filtered dump" >&2; exit 2;; esac
out=${BACKUP_DIR:-$HOME/.qrapp-review/backups}
container=${PGDUMP_CONTAINER:-$(docker ps --format '{{.Names}}' | grep -m1 '^supabase_db_' || true)}
[[ -n $container ]] || { echo "no running supabase_db_* container for pg_dump 17" >&2; exit 2; }
here=$(cd "$(dirname "$0")" && pwd)
fpsql="$here/backup-fingerprint.sql"
mkdir -p "$out" && chmod 700 "$out"
base="$out/qrapp-prod-full-$(date -u +%Y%m%d-%H%M)-$label"
[[ ! -e $base.dump ]] || { echo "exists: $base.dump" >&2; exit 2; }

# psql/pg_* inside the container; the URL travels as an env var, never argv.
src() { docker exec -i -e PGURL="$url" "$container" sh -c "$1"; }
fingerprint_src() { src 'psql -X -q -v ON_ERROR_STOP=1 --dbname="$PGURL" -f -' < "$fpsql"; }

echo "1. source fingerprint (before)"
fingerprint_src > "$base.fp-pre"
echo "2. pg_dump via $container ($(docker exec "$container" pg_dump --version))"
src 'pg_dump --format=custom --no-owner --dbname="$PGURL"' > "$base.dump" 2> "$base.err"
[[ -s $base.dump ]] || { echo "dump is empty; see $base.err" >&2; exit 1; }
echo "3. source fingerprint (after)"
fingerprint_src > "$base.fp-post"
echo "4. sha256 + TOC"
(cd "$out" && shasum -a 256 "$(basename "$base.dump")") > "$base.sha256"
docker exec -i "$container" pg_restore --list < "$base.dump" > "$base.toc"

scratch="restore_check_$(date +%s)"
echo "5. restore into throwaway database $scratch"
docker exec "$container" psql -X -q -U postgres -c "create database $scratch" > /dev/null
[[ ${KEEP_RESTORE:-0} = 1 ]] || trap 'docker exec "$container" psql -X -q -U postgres -c "drop database if exists $scratch" > /dev/null 2>&1 || true' EXIT
docker exec -i "$container" pg_restore --no-owner -U postgres -d "$scratch" < "$base.dump" 2> "$base.restore-errors" || true
docker exec -i "$container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$scratch" -f - < "$fpsql" > "$base.fp-restore"

python3 - "$base" <<'PY' | tee "$base.verify"
import sys
base = sys.argv[1]
load = lambda s: dict(l.rstrip("\n").split("\t", 1) for l in open(f"{base}.{s}") if "\t" in l)
pre, post, rest = load("fp-pre"), load("fp-post"), load("fp-restore")
keys = sorted(set(pre) | set(post) | set(rest))
stable_ok, mismatch, volatile, bad_volatile = 0, [], [], []
for k in keys:
    if pre.get(k) == post.get(k):
        if rest.get(k) == pre.get(k): stable_ok += 1
        else: mismatch.append(k)
    else:
        volatile.append(k)
        if k.startswith(("money:", "ledger:", "schema:")) or k.split(":")[-1].split(".")[-1] in (
            "orders", "payments", "partner_ledger_entries", "payment_refunds", "partner_payouts", "partner_payout_items", "prices", "partners", "admin_users", "__drizzle_migrations"):
            bad_volatile.append(k)
money = [f"  {k} = {pre[k]}" for k in keys if k.startswith(("money:", "ledger:")) and k in pre]
print(f"fingerprint lines: {len(keys)}; identical in restore: {stable_ok}; mismatched: {len(mismatch)}; changed on the source during the dump: {len(volatile)}")
for k in mismatch: print(f"  MISMATCH {k}: source={pre.get(k)} restore={rest.get(k)}")
for k in volatile: print(f"  volatile {k} (written by live traffic during the dump)")
print("money + ledger (source = restore):"); print("\n".join(money))
ok = not mismatch and not bad_volatile
print("RESULT: MATCH" if ok else "RESULT: FAIL" + (" (financial/schema table changed during the dump)" if bad_volatile else ""))
sys.exit(0 if ok else 1)
PY

echo "dump $(du -h "$base.dump" | cut -f1), sha256 $(cut -c1-16 "$base.sha256")…, restore stderr $(grep -c . "$base.restore-errors" || true) line(s): read $base.restore-errors"
[[ ${KEEP_RESTORE:-0} = 1 ]] && echo "kept restore database: $scratch (drop it when done)"
echo "backup: $base.dump"
