#!/bin/sh
# Startet als root, sorgt für Schreibrechte auf /data und wechselt dann zum Benutzer "node".
set -e
mkdir -p "${DATA_DIR:-/data}/questions" "${DATA_DIR:-/data}/avatars"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "${DATA_DIR:-/data}"
  exec su-exec node "$@"
fi
exec "$@"
