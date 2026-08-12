#!/bin/sh
# reset.sh — hourly demo reset, invoked by crond inside the container
#
# Restores the live DB from a pre-seeded snapshot so the demo always shows
# realistic data. After the copy, pkill stops the backend; entrypoint.sh's
# restart loop brings it back with the fresh DB.
#
# The seed snapshot (lyftr.seed.db) is created once on first deploy:
#   fly ssh console -a lyftr-demo
#   cp /app/data/lyftr.db /app/data/lyftr.seed.db
SEED="/app/data/lyftr.seed.db"
LIVE="/app/data/lyftr.db"

if [ ! -f "$SEED" ]; then
    echo "[reset] $(date): no seed snapshot at $SEED — skipping"
    exit 0
fi

echo "[reset] $(date): restoring demo DB..."

# Stop the backend BEFORE touching the file. Copying over a live SQLite
# database while it is open is unsafe: the running process holds its own view
# of the file, and the write can land mid-transaction.
pkill lyftr-api 2>/dev/null || true

# Wait for it to actually exit rather than assuming — pkill only sends the
# signal, and racing the shutdown reintroduces the very problem above.
for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep lyftr-api >/dev/null 2>&1 || break
    sleep 1
done

# Remove the WAL sidecars belonging to the OUTGOING database. Left in place,
# SQLite would replay a write-ahead log from a different database file on top
# of the restored snapshot — corrupting it, or resurrecting fragments of the
# pre-reset data the reset exists to erase.
rm -f "$LIVE-wal" "$LIVE-shm"

cp "$SEED" "$LIVE"
# Match the backend's own permissions on the restored file (see db/sqlite.go).
chmod 600 "$LIVE"

echo "[reset] $(date): done — backend will restart automatically"
