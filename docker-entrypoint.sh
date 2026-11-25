#!/bin/sh
# Startet als root, sorgt für Schreibrechte auf /data und wechselt dann zum Benutzer "node".
set -e
mkdir -p "${DATA_DIR:-/data}/questions" "${DATA_DIR:-/data}/avatars"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "${DATA_DIR:-/data}"
  # Sicherungsordner (z. B. Synology-Freigabe): Rechte setzen, falls möglich – bei SMB/NFS regeln das die Mount-Optionen
  mkdir -p "${BACKUP_DIR:-/backups}" 2>/dev/null || true
  chown node:node "${BACKUP_DIR:-/backups}" 2>/dev/null || true
  exec su-exec node "$@"
fi
exec "$@"
