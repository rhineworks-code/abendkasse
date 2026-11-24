# Abendkasse – das Wochen-Quiz für zwei

Jeden Tag gibt es neue Quizfragen. Um **20:00 Uhr** wird ausgezahlt: Jede richtige Antwort wird als Punkte auf dein Konto gebucht. Nach 7 Tagen endet die Woche, der Wochensieger bekommt einen Bonus und die nächste Woche startet automatisch.

## Installation

```bash
git clone https://github.com/rhineworks-code/abendkasse.git
cd abendkasse
cp .env.example .env       # Einstellungen anpassen (Port, PUBLIC_URL …)
./update.sh
```

Danach läuft das Spiel unter `http://<server>:8020` (Port über `HOST_PORT` in `.env`). Daten (SQLite, Profilbilder) liegen in `./data`.

## Update

```bash
./update.sh
```

Das Skript sichert `data/` nach `backups/` (die letzten 5 bleiben), holt den neuen Stand von GitHub (`git pull`), lädt das neue Docker-Image, startet den Container neu und räumt alte Images auf.
Das Image wird bei jedem Push auf `main` automatisch per GitHub Actions gebaut (`ghcr.io/rhineworks-code/abendkasse:latest`, amd64 + arm64).

**Eigene Einstellungen gehören in `.env`**, nicht in die `docker-compose.yml`. `.env` wird von Git ignoriert und bei Updates nie überschrieben.

Lokal bauen statt pullen: in der `docker-compose.yml` `image:` auskommentieren, `build: .` aktivieren und `docker compose up -d --build` ausführen.

## So funktioniert's

1. Namen eingeben, dann ein Spiel erstellen und Genres, Fragen-Mix und Fragen pro Tag wählen.
2. Über **„Einladung senden“** den Link teilen: über das Teilen-Menü des Handys, WhatsApp, Telegram, SMS oder E-Mail. Alternativ den **6-stelligen Code** weitergeben.
3. Jeden Tag bis 20:00 Uhr die Tagesfragen beantworten (Standard: 10). Einmal pro Tag gibt es einen **50:50-Joker**, der zwei falsche Antworten streicht. Jede Antwort ist endgültig, und die Lösung bleibt bis zur Auszahlung verborgen. Den Fortschritt des anderen (z. B. 3/5) siehst du live.
4. Um 20:00 Uhr kommt die Auflösung: Du siehst, wer was getippt hat, und die Punkte werden gebucht.
5. Nach Tag 7 wird die Woche abgeschlossen. Der Sieger bekommt den Wochenbonus, bei Gleichstand beide.

**Tag wiederholen oder streichen:** Ist der Server ausgefallen oder konnte jemand nicht mitspielen, tippt man in der Wochenansicht bei einem vergangenen Tag der laufenden Woche auf **↻**:
- **Tag wiederholen:** Die Punkte des Tages werden zurückgebucht (Storno im Konto). Ihr bekommt neue Fragen als **Nachholrunde**, spielbar bis zur nächsten Auszahlung um 20 Uhr, zusätzlich zur normalen Tagesrunde. Das geht auch für Tage, an denen gar nicht gespielt wurde.
- **Tag streichen:** Die Punkte des Tages werden für alle zurückgebucht, der Tag zählt nicht.

Damit das fair bleibt, müssen **alle Mitspieler zustimmen**. Die Anfrage erscheint beim anderen als Hinweis mit „Zustimmen / Ablehnen“. Der alte Stand des Tages wird in der Datenbank archiviert.

**Punkte (Standard):** 10 pro richtige Antwort · +20 für einen perfekten Tag · +100 für den Wochensieg.

Ein Spiel, das nach 20 Uhr erstellt wird, startet am nächsten Tag. Läuft der Container um 20 Uhr nicht, wird die Auszahlung beim nächsten Start nachgeholt.

## Einstellungen (.env)

| Variable | Standard | Bedeutung |
|---|---|---|
| `HOST_PORT` | 8020 | Port auf dem Server |
| `PAYOUT_HOUR` | 20 | Stunde der Auszahlung |
| `OPEN_HOUR` | 0 | Ab dieser Stunde sind die Tagesfragen offen |
| `QUESTIONS_PER_DAY` | 10 | Vorgabe für neue Spiele |
| `JOKERS_PER_DAY` | 1 | 50:50-Joker pro Spieler und Tag |
| `WEEK_DAYS` | 7 | Länge einer Spielwoche |
| `POINTS_PER_CORRECT` / `PERFECT_DAY_BONUS` / `WEEK_WIN_BONUS` | 10 / 20 / 100 | Punkte |
| `MAX_PLAYERS` | 2 | Spieler pro Spiel |
| `GAME_TZ` | Europe/Berlin | Zeitzone für Tageswechsel und Auszahlung |
| `PUBLIC_URL` | leer | Externe Adresse für Einladungslinks (sonst die Adresse, über die du die Seite gerade aufrufst) |
| `ADMIN_TOKEN` | leer | Schaltet die Admin-Endpunkte frei |
| `WEBHOOK_URL` | leer | Bekommt bei jeder Auszahlung und jedem Wochenende ein JSON per POST (z. B. für einen Home-Assistant-Webhook) |

## Eigene Fragen

Lege JSON-Dateien in `./data/questions/` ab. Die richtige Antwort steht immer an **zweiter** Stelle. Gemischt wird automatisch.

```json
{
  "Filme": [
    ["Wer spielte Neo in Matrix?", "Keanu Reeves", "Tom Cruise", "Brad Pitt", "Will Smith"]
  ],
  "Unsere Insider": [
    ["Wo waren wir 2019 im Urlaub?", "Kroatien", "Italien", "Spanien", "Portugal"]
  ]
}
```

Neue Genres tauchen automatisch bei „Neues Spiel“ auf. Zum Neu-Laden den Container neu starten oder Folgendes ausführen:
`curl -X POST -H "X-Admin-Token: …" http://<server>:8084/api/admin/reload-questions`

Eine Frage wird pro Spiel erst wiederholt, wenn alle Fragen der gewählten Genres einmal dran waren.

## Admin / Testen

```bash
# Heutige Runden sofort auszahlen (zum Testen)
curl -X POST -H "X-Admin-Token: DEINTOKEN" http://<server>:8084/api/admin/payout-now
```

## Von außen erreichbar machen

Den Container hinter deinen Reverse Proxy hängen (Nginx Proxy Manager, Traefik, Caddy …) und HTTPS aktivieren, z. B. `quiz.deinedomain.de → http://<docker-host>:8084`. Die App vertraut `X-Forwarded-For` (für das Rate-Limit).

**Profil:** Unter „Profil“ (oben rechts auf deinen Namen tippen) kannst du deinen Namen ändern und ein Profilbild hochladen. Das Bild wird im Browser quadratisch auf 256 px zugeschnitten und landet in `data/avatars/`.

Anmeldung: Jeder Spieler bekommt beim ersten Besuch ein geheimes Token, das im Browser gespeichert wird. Unter **Profil** steht der Wiederherstellungs-Code, mit dem man sich auf einem anderen Gerät anmeldet. Ohne Code kommt niemand an ein Konto oder in ein Spiel. Zum Beitreten braucht man zusätzlich den Spiel-Code.

## Technik

Node.js 22 (eingebautes `node:sqlite`, keine nativen Abhängigkeiten) · Express · Vanilla-JS-Frontend · SQLite in `/data/abendkasse.db`.

```
src/server.js     API + statische Dateien + Minuten-Takt
src/game.js       Wochen, Tagesrunden, Auszahlung, Konto
src/questions.js  Fragenkatalog laden
questions/        mitgelieferte Fragen (386 in 8 Genres)
public/           Frontend
```
