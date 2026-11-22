#!/bin/sh
# Abendkasse aktualisieren: Datensicherung, neuen Code + neues Image holen, Container neu starten.
set -e
cd "$(dirname "$0")"

# Eigene Einstellungen liegen in .env (wird von Git nicht angefasst)
[ -f .env ] || { cp .env.example .env; echo "Hinweis: .env angelegt – Einstellungen dort anpassen (z. B. PUBLIC_URL)."; }

mkdir -p backups
tar czf "backups/data-$(date +%Y%m%d-%H%M%S).tar.gz" data 2>/dev/null && echo "Datensicherung angelegt (backups/)"
ls -1t backups/data-*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm -f      # nur die letzten 5 behalten

if [ -d .git ]; then
  echo "Hole neuen Stand von GitHub …"
  git pull --ff-only --autostash -q || echo "Warnung: git pull fehlgeschlagen – lokale Änderungen? (git status)"
fi

docker compose pull
docker compose up -d
docker image prune -f >/dev/null
echo "Fertig. Version: $(git rev-parse --short HEAD 2>/dev/null || echo unbekannt)"
docker compose logs --tail 3 abendkasse 2>/dev/null | tail -3
