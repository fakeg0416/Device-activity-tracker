================================================================
  DEVICE ACTIVITY TRACKER — UPDATE BESTANDEN
================================================================

GitHub repository:
  https://github.com/fakeg0416/Device-activity-tracker

----------------------------------------------------------------
OPTIE 1 — UPDATE VIA GITHUB (aanbevolen)
----------------------------------------------------------------

  Bestaande installatie bijwerken:
    cd device-activity-tracker-master
    git pull origin main
    docker compose down
    docker compose build --no-cache
    docker compose up -d

  Verse installatie (nog geen lokale map):
    git clone https://github.com/fakeg0416/Device-activity-tracker.git
    cd Device-activity-tracker
    docker compose up -d

  Open daarna: http://localhost:3000

----------------------------------------------------------------
OPTIE 2 — HANDMATIG BESTANDEN KOPIËREN
----------------------------------------------------------------

Als je geen Git gebruikt: kopieer de bestanden uit deze map
naar de juiste plek in je bestaande installatie.

MAPSTRUCTUUR — kopieer elk bestand naar hetzelfde pad:
----------------------------------------------------------------

  UPDATE_FILES\
  │
  ├── src\
  │   ├── server.ts       →  device-activity-tracker-master\src\server.ts
  │   └── tracker.ts      →  device-activity-tracker-master\src\tracker.ts
  │
  └── client\src\components\
      ├── Login.tsx        →  device-activity-tracker-master\client\src\components\Login.tsx
      └── ContactCard.tsx  →  device-activity-tracker-master\client\src\components\ContactCard.tsx

----------------------------------------------------------------
NA HET KOPIEREN — opnieuw bouwen
----------------------------------------------------------------

  MET DOCKER (aanbevolen):
  ------------------------
    cd device-activity-tracker-master
    docker compose down
    docker compose build --no-cache
    docker compose up -d

  HANDMATIG (zonder Docker):
  --------------------------
    Venster 1 — backend bouwen en starten:
      cd device-activity-tracker-master
      npm run build
      node dist/server.js

    Venster 2 — frontend bouwen en starten:
      cd device-activity-tracker-master\client
      npm run build
      npx serve -s build -l 3000

    Open daarna: http://localhost:3000

----------------------------------------------------------------
WAT IS ER GEWIJZIGD?
----------------------------------------------------------------

  server.ts (v1)
    - WhatsApp verbinding werkt nu correct op Node 20+
    - WhatsApp QR-code verschijnt opnieuw na uitloggen
    - Overbodige debug-logging uitgeschakeld

  tracker.ts (v1)
    - Probes worden 5x sneller verstuurd (400ms i.p.v. 2000ms)
    - Timeout verkort van 10s naar 3.5s voor snellere Offline-detectie
    - Online-status wordt nu correct bepaald via WhatsApp presence
    - Bug opgelost: na een Offline-periode werd Online niet meer herkend

  tracker.ts (v2 — 2026-03-26)
    - Bug opgelost: 'paused' presence werd als Standby geclassificeerd
      terwijl de gebruiker nog steeds in de chat zit → nu correct Online
    - Presence-timeout toegevoegd: als er 45 seconden geen nieuwe presence
      binnenkomt terwijl de status Online is, wordt automatisch naar
      Standby gedegradeerd (WhatsApp stuurt niet altijd 'unavailable')
    - sendUpdate virtual entry: ook 'composing' en 'paused' geven nu
      correct Online (was alleen 'available')

  Login.tsx
    - Signal QR-code ververst automatisch elke 25 seconden
      (voorheen verliep de QR zonder dat de pagina dit doorhad)

  ContactCard.tsx
    - Statusbadge toont nu correcte labels: Online / Standby / Offline
    - Statusbadge: hover = uitleg wat de status betekent
    - Blauw vraagteken naast RTT/Median/Threshold: hover = uitleg
    - Statuslegenda toegevoegd (groene/gele/rode stip met uitleg)
    - Gele stip bij Standby (was grijs)

================================================================
