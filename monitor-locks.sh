#!/bin/bash
# monitor-locks.sh (for PostgreSQL)

PG_USER="user"
PG_DB="inventory_db"

while true; do
  echo "--- Active Locks at $(date) ---"
  # This query shows active locks in the inventory_db
  docker exec -i $(docker compose ps -q db) psql -U $PG_USER -d $PG_DB -c "SELECT relation::regclass, locktype, mode, granted FROM pg_locks WHERE pid IN (SELECT pid FROM pg_stat_activity WHERE datname = '$PG_DB');"
  sleep 2
done
