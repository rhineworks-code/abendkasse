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

**Push-Benachrichtigungen:** Unter **Profil → Benachrichtigungen** pro Gerät aktivieren. Du bekommst eine Nachricht, wenn
- dein Partner seine Runde gespielt hat (oder ihr beide fertig seid),
- morgens ab 6 Uhr eine neue Tagesrunde wartet (nur an die, die noch nicht gespielt haben),
- um 20 Uhr ausgezahlt wird (eine Nachricht mit allen Ergebnissen),
- eine Extrarunde angeboten wird, dein Partner zugestimmt hat oder sie startet,
- jemand einen Tag wiederholen oder streichen möchte.

Push funktioniert nur über **HTTPS** (Reverse Proxy). Auf dem **iPhone** (ab iOS 16.4) muss Abendkasse zuerst über Safari → Teilen → **Zum Home-Bildschirm** hinzugefügt und von dort geöffnet werden. Android und Desktop-Browser funktionieren direkt. Die Schlüssel für den Versand (VAPID) werden beim ersten Start automatisch in `data/vapid.json` erzeugt. Diese Datei gehört zur Datensicherung: Geht sie verloren, muss jeder Push neu aktivieren.

**Extrarunde:** Habt ihr beide eure Tagesrunde **vor 15 Uhr** gespielt, wird eine Extrarunde mit **5 Zusatzfragen** angeboten (oben im Spiel und per Push). Erst wenn **beide zustimmen**, geht es los. Die Extrarunde läuft bis 20 Uhr, wird zusammen mit der Tagesrunde ausgezahlt und zählt für die Woche. Lehnt einer ab, gibt es an diesem Tag keine Extrarunde.

**Schwierigkeit:** Jede Frage hat eine Stufe (●○○ leicht, ●●○ mittel, ●●● schwer). Pro Spiel wählst du:
- **Leicht:** nur leichte Fragen
- **Mittel** (Standard): leichte und mittlere Fragen, keine schweren
- **Schwer:** vor allem schwere, dazu mittlere Fragen
- **Gemischt:** alle Stufen

Innerhalb eines Tages geht es immer von leicht nach schwer. Ändern kann man die Stufe jederzeit unter **Woche → Schwierigkeit**. Sie gilt ab der nächsten neuen Runde. Gibt es in den gewählten Genres zu wenige Fragen einer Stufe, werden automatisch auch andere Stufen genommen.

**Tag wiederholen oder streichen:** Ist der Server ausgefallen oder konnte jemand nicht mitspielen, tippt man in der Wochenansicht bei einem vergangenen Tag der laufenden Woche auf **↻**:
- **Tag wiederholen:** Die Punkte des Tages werden zurückgebucht (Storno im Konto). Ihr bekommt neue Fragen als **Nachholrunde**, spielbar bis zur nächsten Auszahlung um 20 Uhr, zusätzlich zur normalen Tagesrunde. Das geht auch für Tage, an denen gar nicht gespielt wurde.
- **Tag streichen:** Die Punkte des Tages werden für alle zurückgebucht, der Tag zählt nicht.

Damit das fair bleibt, müssen **alle Mitspieler zustimmen**. Die Anfrage erscheint beim anderen als Hinweis mit „Zustimmen / Ablehnen“. Der alte Stand des Tages wird in der Datenbank archiviert.

**Einsatz pro Frage:** Vor jeder Frage siehst du nur Genre, Stufe und Fragetyp und setzt **0, 10, 20 oder 30 Punkte**. Richtig: Einsatz gewonnen, falsch: Einsatz verloren. Gesetzt werden kann nur, was auf dem Konto frei ist (Kontostand minus noch offene Einsätze).

**Tempo-Bonus:** Mit dem Aufdecken startet die Uhr. Wer innerhalb von **5 Sekunden** richtig antwortet, bekommt **+2 Punkte**. Die Zeit misst der Server. Die Frage wird erst beim Aufdecken übertragen, Googeln lohnt sich also nicht.

**Duell-Frage des Tages:** Nach den Tagesfragen kommt eine **Schätzfrage** (z. B. „Wie hoch ist der Kölner Dom?“). Wer näher an der richtigen Zahl liegt, bekommt **20 Punkte**, bei Gleichstand bekommt jeder 10.

**Fragetypen:** Multiple Choice, **Wahr/Falsch**, **Reihenfolge** (Einträge in der richtigen Reihenfolge antippen) und **Bildfragen** (z. B. „Welches Land hat diese Flagge?“). Der 50:50-Joker gilt nur für Fragen mit vier Antworten.

**Wusstest du?** Bei der Auflösung steht unter jeder Frage eine kurze Erklärung.

**Themenwoche:** Unter **Woche → Themenwoche** einschalten. Dann dreht sich eine ganze Woche um ein Genre. Der **Wochensieger wählt das Thema der nächsten Woche** und bekommt dazu eine Push-Nachricht. Wählt niemand bis zur ersten Runde der neuen Woche, entscheidet der Zufall. Bei 10 Fragen am Tag kann sich innerhalb einer Themenwoche eine Frage wiederholen, weil ein Genre nur rund 70 Fragen hat.

**Fragen melden:** In der Auflösung hat jede Frage einen Knopf **⚑ Melden** (Antwort falsch, zu schwer, zu leicht, unklar, Sonstiges). Spielleiter sehen in der Übersicht **„Gemeldete Fragen“** mit der bisherigen Trefferquote der Frage und können die **Stufe ändern** oder die Frage **aussortieren**. Das gilt sofort. Falsche Antworten korrigiert man dauerhaft in der JSON-Datei.

**Statistik & Abzeichen:** Im Tab **Statistik** stehen Trefferquote gesamt, pro Genre, Stufe und Fragetyp, Wochen- und Tagessiege im direkten Vergleich, aktuelle und längste Serie, Duelle, Tempo-Boni, Einsätze und Punkte pro Woche. Dazu gibt es Hinweise wie „Du bist in Geschichte stärker als Sarah“ und 23 **Abzeichen** (Perfekter Tag, 5 Wochensiege, 7 Tage am Stück, 50 richtige pro Genre, Hellseher, Zocker …). Neue Abzeichen werden nach der Auszahlung per Push gemeldet.

**Erinnerung:** Um **18 Uhr** kommt ein Push an alle, die ihre Tagesrunde noch nicht gespielt haben.

**Darstellung:** Unter **Profil → Darstellung** stellst du Hell, Dunkel oder Automatisch (nach Systemeinstellung) ein, außerdem die Schriftgröße Normal, Groß oder Sehr groß. Das gilt pro Gerät.

**Punkte (Standard):** 10 pro richtige Antwort · +20 für eine perfekte Runde · +2 Tempo-Bonus · ±Einsatz · +20 für die Duell-Frage · +100 für den Wochensieg. Im Konto ist jede Buchung einzeln aufgeschlüsselt.

Ein Spiel, das nach 20 Uhr erstellt wird, startet am nächsten Tag. Läuft der Container um 20 Uhr nicht, wird die Auszahlung beim nächsten Start nachgeholt.

## Einstellungen (.env)

| Variable | Standard | Bedeutung |
|---|---|---|
| `HOST_PORT` | 8020 | Port auf dem Server |
| `MORNING_HOUR` | 6 | Ab dieser Stunde kommt der Push „Neue Tagesrunde“ |
| `EXTRA_BEFORE_HOUR` | 15 | Extrarunde, wenn alle vor dieser Stunde fertig sind |
| `EXTRA_QUESTIONS` | 5 | Fragen in der Extrarunde |
| `MAX_STAKE` / `STAKE_STEP` | 30 / 10 | Höchsteinsatz pro Frage und Schrittweite |
| `TEMPO_SECONDS` / `TEMPO_BONUS` | 5 / 2 | Tempo-Bonus: Zeitgrenze und Punkte |
| `DUEL_POINTS` | 20 | Punkte für die beste Schätzung |
| `REMINDER_HOUR` | 18 | Erinnerungs-Push, falls noch nicht gespielt |
| `BACKUP_PATH` | ./backups/auto | Zielordner der nächtlichen Sicherung auf dem Server |
| `BACKUP_HOUR` / `BACKUP_KEEP` | 3 / 14 | Uhrzeit der Sicherung und wie viele Tage aufbewahrt werden |
| `VAPID_SUBJECT` | mailto:abendkasse@example.com | Absenderangabe für Web-Push (beliebige Mail- oder https-Adresse) |
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

Lege JSON-Dateien in `./data/questions/` ab. Die richtige Antwort steht immer an **zweiter** Stelle. Gemischt wird automatisch. Die Zahl am Ende ist die Schwierigkeit (1 = leicht, 2 = mittel, 3 = schwer). Sie ist optional, ohne Zahl gilt „mittel“.

```json
{
  "Filme": [
    ["Wer spielte Neo in Matrix?", "Keanu Reeves", "Tom Cruise", "Brad Pitt", "Will Smith", 2]
  ],
  "Unsere Insider": [
    ["Wo waren wir 2019 im Urlaub?", "Kroatien", "Italien", "Spanien", "Portugal", 1]
  ]
}
```

Neue Genres tauchen automatisch bei „Neues Spiel“ auf. Zum Neu-Laden den Container neu starten oder Folgendes ausführen:
`curl -X POST -H "X-Admin-Token: …" http://<server>:8084/api/admin/reload-questions`

Eine Frage wird pro Spiel erst wiederholt, wenn alle Fragen der gewählten Genres einmal dran waren.


Neben Multiple Choice gehen auch diese Typen (als Objekt):
```json
{
  "Unsere Insider": [
    {"type": "tf", "q": "Wir haben uns 2015 kennengelernt.", "answer": true, "level": 1, "explain": "Auf Sarahs Geburtstag!"},
    {"type": "order", "q": "Ordne unsere Urlaube chronologisch.", "items": ["Rom", "Kroatien", "Lissabon", "Oslo"], "level": 2},
    {"type": "mc", "q": "Wo ist dieses Foto entstanden?", "correct": "Gardasee", "wrong": ["Bodensee", "Chiemsee", "Comer See"], "image": "/eigene/urlaub.jpg"},
    {"type": "estimate", "q": "Wie viele Kilometer sind wir 2023 gewandert?", "answer": 312, "unit": "km"}
  ]
}
```
- `order`: die Einträge **in der richtigen Reihenfolge** angeben, gemischt wird automatisch.
- `estimate`: Schätzfragen kommen als **Duell-Frage des Tages** dran.
- Bilder für eigene Bildfragen in `data/questions/bilder/` ablegen und als `"/eigene/dateiname.jpg"` angeben.
- Bei Multiple Choice ist die Erklärung der optionale 7. Wert: `["Frage", "richtig", "f1", "f2", "f3", 2, "Wusstest du …"]`.

## Datensicherung (z. B. auf die Synology)

Jede Nacht um **3 Uhr** sichert Abendkasse sich selbst in den Ordner `BACKUP_PATH`. Dabei entsteht ein Ordner `abendkasse-JJJJ-MM-TT` mit Datenbank (konsistente Kopie), Push-Schlüsseln, Profilbildern und eigenen Fragen. Die letzten 14 Tage bleiben erhalten.

**Synology als Ziel**, Variante A (empfohlen): Freigabe auf dem Docker-Host einbinden und den Pfad in `.env` eintragen.
```bash
# z. B. per NFS (in der Synology: Systemsteuerung → Dateidienste → NFS aktivieren, Freigabe → NFS-Berechtigungen für den Docker-Host)
sudo mkdir -p /mnt/synology/abendkasse
echo "synology.local:/volume1/backup/abendkasse /mnt/synology/abendkasse nfs defaults,_netdev 0 0" | sudo tee -a /etc/fstab
sudo mount -a
```
```ini
# .env
BACKUP_PATH=/mnt/synology/abendkasse
```

Variante B, ohne Mount auf dem Host: SMB-Freigabe direkt als Docker-Volume. Dazu in der `docker-compose.yml` die Zeile `- ${BACKUP_PATH…}:/backups` durch `- synology:/backups` ersetzen und unten ergänzen:
```yaml
volumes:
  synology:
    driver: local
    driver_opts:
      type: cifs
      device: "//synology.local/backup/abendkasse"
      o: "username=BENUTZER,password=PASSWORT,uid=1000,gid=1000,vers=3.0"
```

Sicherung sofort auslösen bzw. Status prüfen (mit `ADMIN_TOKEN`):
```bash
curl -X POST -H "X-Admin-Token: DEINTOKEN" http://<server>:8020/api/admin/backup
curl -H "X-Admin-Token: DEINTOKEN" http://<server>:8020/api/admin/backup
```
Wiederherstellen: Container stoppen, `abendkasse.db`, `vapid.json` und `avatars/` aus dem Sicherungsordner nach `data/` kopieren und den Container wieder starten.

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
src/game.js       Wochen, Runden, Einsatz/Tempo/Duell, Auszahlung, Konto, Themenwoche, Pushes
src/questions.js  Fragenkatalog laden (alle Fragetypen)
src/stats.js      Statistik und Abzeichen
src/reports.js    Gemeldete Fragen, Korrekturen am Katalog
src/backup.js     Nächtliche Sicherung
src/push.js       Web-Push
questions/        mitgelieferte Fragen (623 in 8 Genres inkl. Wahr/Falsch, Reihenfolge und 60 Flaggen, dazu 59 Schätzfragen; alle mit Erklärung)
public/           Frontend
```
