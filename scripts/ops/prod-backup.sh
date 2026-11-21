#!/usr/bin/env bash
# Verified full database backup before a production migration (BOG release step B).
#
#   BACKUP_DATABASE_URL=<migrations-owner URL>  scripts/ops/prod-backup.sh <label>
#
# - Dumps the whole database (custom format, all schemas incl. auth/storage
#   metadata) with pg_dump from a local Postgres 17 container (PGDUMP_CONTAINER,
#   default: the first running supabase_db_* container), so the client
#   matches the server major version.
# - Writes <out>/qrapp-prod-full-<UTC stamp>-<label>.{dump,sha256,toc,counts,err}.
# - Restores the dump into a throwaway database inside that container, counts
#   every table again and compares (.restore-counts / .restore-errors), then
#   drops the throwaway database. Exit 0 only when the counts MATCH.
# - Never prints the URL or any row data. Read-only against the source.
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
mkdir -p "$out"
base="$out/qrapp-prod-full-$(date -u +%Y%m%d-%H%M)-$label"
[[ ! -e $base.dump ]] || { echo "exists: $base.dump" >&2; exit 2; }

# Exact row count of every ordinary table, as "schema.table<TAB>count", sorted.
count_sql="select n.nspname||'.'||c.relname||chr(9)||(xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p') and n.nspname in ('public','auth','storage','drizzle')
order by 1"

echo "pg_dump via $container ($(docker exec "$container" pg_dump --version))"
docker exec -e PGURL="$url" "$container" sh -c 'pg_dump --format=custom --no-owner --dbname="$PGURL"' > "$base.dump" 2> "$base.err"
[[ -s $base.dump ]] || { echo "dump is empty; see $base.err" >&2; exit 1; }
shasum -a 256 "$base.dump" > "$base.sha256"
docker exec -i "$container" pg_restore --list < "$base.dump" > "$base.toc"
docker exec -e PGURL="$url" "$container" sh -c 'psql -X -qAt --dbname="$PGURL" -c "$0"' "$count_sql" > "$base.counts"

scratch="restore_check_$(date +%s)"
docker exec "$container" psql -X -q -U postgres -c "create database $scratch" > /dev/null
trap 'docker exec "$container" psql -X -q -U postgres -c "drop database if exists $scratch" > /dev/null 2>&1 || true' EXIT
docker exec -i "$container" pg_restore --no-owner --no-privileges -U postgres -d "$scratch" < "$base.dump" 2> "$base.restore-errors" || true
docker exec "$container" psql -X -qAt -U postgres -d "$scratch" -c "$count_sql" > "$base.restore-counts"

tables=$(wc -l < "$base.counts" | tr -d ' ')
rows=$(awk -F'\t' '{s+=$2} END {print s+0}' "$base.counts")
echo "dump $(du -h "$base.dump" | cut -f1), sha256 $(cut -c1-16 "$base.sha256")…, $tables tables, $rows rows"
echo "restore errors: $(grep -c . "$base.restore-errors" || true) line(s) (role/extension noise is expected; read the file)"
# Compare only application data (public + drizzle): auth/storage restore into a
# plain database may differ in Supabase-managed tables.
app() { grep -E '^(public|drizzle)\.' "$1"; }
if diff <(app "$base.counts") <(app "$base.restore-counts") > /dev/null; then
  echo "MATCH: public + drizzle row counts identical after restore -> $base.dump"
else
  echo "MISMATCH: see diff of $base.counts and $base.restore-counts" >&2; exit 1
fi
grep -E '^drizzle\.__drizzle_migrations' "$base.counts" | sed 's/^/migrations ledger: /'
