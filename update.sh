#!/bin/sh
# Abendkasse aktualisieren: Datensicherung, neuen Code + neues Image holen, Container neu starten.
set -e
cd "$(dirname "$0")"

# Eigene Einstellungen liegen in .env (wird von Git nicht angefasst)
[ -f .env ] || { cp .env.example .env; echo "Hinweis: .env angelegt – Einstellungen dort anpassen (z. B. PUBLIC_URL)."; }

# Token für den Updater (Update aus der App) einmalig erzeugen
if ! grep -q '^UPDATE_TOKEN=..' .env; then
  TOKEN=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
  if grep -q '^UPDATE_TOKEN=' .env; then sed -i "s/^UPDATE_TOKEN=.*/UPDATE_TOKEN=$TOKEN/" .env; else printf '\n# Geheimes Token für den Updater\nUPDATE_TOKEN=%s\n' "$TOKEN" >> .env; fi
  echo "Updater-Token erzeugt."
fi

mkdir -p backups
tar czf "backups/data-$(date +%Y%m%d-%H%M%S).tar.gz" data 2>/dev/null && echo "Datensicherung angelegt (backups/)"
ls -1t backups/data-*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm -f      # nur die letzten 5 behalten

if [ -d .git ]; then
  echo "Hole neuen Stand von GitHub …"
  git fetch -q origin
  if ! git merge --ff-only -q origin/main 2>/dev/null; then
    # Verlauf auf GitHub wurde neu geschrieben: auf den GitHub-Stand setzen (.env und data/ sind nicht im Repo)
    if git diff --quiet && git diff --cached --quiet; then
      git reset -q --hard origin/main && echo "Auf den aktuellen GitHub-Stand gesetzt."
    else
      echo "Warnung: lokale Änderungen an Repo-Dateien – bitte prüfen (git status)."
    fi
  fi
fi

docker compose pull
docker compose up -d
docker image prune -f >/dev/null
echo "Fertig. Version: $(git rev-parse --short HEAD 2>/dev/null || echo unbekannt)"
docker compose logs --tail 3 abendkasse 2>/dev/null | tail -3
