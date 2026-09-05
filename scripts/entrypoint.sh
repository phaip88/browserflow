#!/bin/sh
set -e

DATA_DIR="${BROWSERFLOW_DATA_DIR:-/app/data}"
RUNTIME_DIR="${BROWSERFLOW_RUNTIME_DIR:-/app/data/runtime}"
PGDATA="$DATA_DIR/postgres"

mkdir -p "$DATA_DIR" "$RUNTIME_DIR" /app/secrets
chown -R browserflow:browserflow "$DATA_DIR" "$RUNTIME_DIR" /app/secrets 2>/dev/null || true
chmod -R 777 "$DATA_DIR" "$RUNTIME_DIR" /app/secrets 2>/dev/null || true

# If DATABASE_URL points to localhost/127.0.0.1, handle embedded PostgreSQL
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/browserflow}"
export DATABASE_URL

case "$DATABASE_URL" in
  *127.0.0.1*|*localhost*)
    PG_INITDB=$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb 2>/dev/null | head -n1 || true)
    if [ -n "$PG_INITDB" ]; then
      PG_BIN_DIR=$(dirname "$PG_INITDB")
      if [ ! -d "$PGDATA" ] || [ ! -f "$PGDATA/PG_VERSION" ]; then
        echo "[entrypoint] Initializing PostgreSQL in $PGDATA..."
        mkdir -p "$PGDATA"
        chown -R postgres:postgres "$PGDATA" 2>/dev/null || true
        chmod 700 "$PGDATA"
        su -s /bin/sh postgres -c "$PG_BIN_DIR/initdb -D '$PGDATA' --auth-local=trust --auth-host=trust"
      fi
      echo "[entrypoint] Starting PostgreSQL daemon..."
      chown -R postgres:postgres "$PGDATA" 2>/dev/null || true
      chmod 700 "$PGDATA"
      su -s /bin/sh postgres -c "$PG_BIN_DIR/pg_ctl -D '$PGDATA' -l /tmp/postgres.log -o '-k /tmp' start"

      for i in $(seq 1 30); do
        if su -s /bin/sh postgres -c "$PG_BIN_DIR/pg_isready -h 127.0.0.1 -p 5432" >/dev/null 2>&1; then
          echo "[entrypoint] PostgreSQL is online."
          break
        fi
        sleep 0.5
      done

      # Create database if not exists
      su -s /bin/sh postgres -c "psql -h 127.0.0.1 -U postgres -tc \"SELECT 1 FROM pg_database WHERE datname = 'browserflow'\" | grep -q 1 || psql -h 127.0.0.1 -U postgres -c 'CREATE DATABASE browserflow;'" 2>/dev/null || true
    fi
    ;;
esac

# Run schema migrations
echo "[entrypoint] Syncing database schema..."
su -s /bin/sh browserflow -c "npx drizzle-kit push --force" 2>/dev/null || npx drizzle-kit push --force || echo "[entrypoint] Drizzle push warning, continuing..."

echo "[entrypoint] Launching application: $@"
if [ "$(id -u)" = "0" ]; then
  exec su -s /bin/sh browserflow -c "$*"
else
  exec "$@"
fi
