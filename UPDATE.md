# Device Activity Tracker — Update v1.1

> **Wat is er veranderd?**
> Verbeterde status-detectie (Online/Standby/Offline), tooltips met uitleg op alle meetwaarden en statuslabels, bugfixes in de tracker-logica.

---

## Inhoudsopgave

1. [Wat is er nieuw?](#1-wat-is-er-nieuw)
2. [Gewijzigde bestanden](#2-gewijzigde-bestanden)
3. [Update installeren](#3-update-installeren)
   - [Optie A — Docker (aanbevolen)](#optie-a--docker-aanbevolen)
   - [Optie B — Handmatig (zonder Docker)](#optie-b--handmatig-zonder-docker)
4. [Wat betekenen de statussen?](#4-wat-betekenen-de-statussen)
5. [Bekende beperking: Online niet zichtbaar](#5-bekende-beperking-online-niet-zichtbaar)

---

## 1. Wat is er nieuw?

### Statusweergave
| Situatie | Vorige versie | Nieuwe versie |
|---|---|---|
| WhatsApp open & actief | Standby *(bug)* | **Online** ✅ |
| Telefoon aan, app op achtergrond | Standby | **Standby** ✅ |
| Geen reactie / telefoon uit | Offline | **Offline** ✅ |
| Status na netwerk-timeout herstel | Bleef OFFLINE *(bug)* | Correct bijgewerkt ✅ |

### Tooltips & uitleg
- **Hover op de statusbadge** (Online/Standby/Offline) → uitleg wat de status betekent
- **Blauw `?`-icoontje** naast Current Avg RTT, Median en Threshold → hover = uitleg van de meetwaarde
- **Status-legenda** toegevoegd onderaan de contactkaart (vaste uitleg van alle drie de statussen)

### Bug fixes (tracker-logica)
- `available` presence kan nu de `OFFLINE`-status wissen — voorheen bleef een contact na een probe-timeout vastzitten op OFFLINE, ook als de persoon WhatsApp daarna gewoon open had
- `available` presence wordt nu direct als `Online` weergegeven in de UI zonder afhankelijkheid van de device-state buffer

---

## 2. Gewijzigde bestanden

```
device-activity-tracker-master/
├── src/
│   └── tracker.ts                          ← Bug fix: OFFLINE → Online via presence
└── client/src/components/
    └── ContactCard.tsx                     ← UI: tooltips, status-legenda, bugfix
```

**Geen wijzigingen in:**
`server.ts`, `signal-tracker.ts`, `docker-compose.yml`, `Dockerfile`, `App.tsx`, `Dashboard.tsx`

---

## 3. Update installeren

> **Vereisten:** Node.js 20+, npm, optioneel Docker Desktop

### Optie A — Docker (aanbevolen)

Bestaande containers stoppen, image opnieuw bouwen en opstarten.
WhatsApp-sessie (QR-scan) blijft bewaard via het `baileys_auth` volume.

Open **Command Prompt** of **PowerShell** in de project-map:

```
cd "pad\naar\device-activity-tracker-master"
```

```
docker compose down
docker compose build --no-cache
docker compose up -d
```

Daarna bereikbaar op:
- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:3001

Logs bekijken:
```
docker compose logs -f backend
docker compose logs -f client
```

---

### Optie B — Handmatig (zonder Docker)

Je hebt drie aparte processen nodig: backend, frontend en (optioneel) Signal API.

#### Stap 1 — Afhankelijkheden installeren

```
cd "pad\naar\device-activity-tracker-master"
npm install
```

#### Stap 2 — Backend bouwen

```
npm run build
```

Verwacht resultaat: map `dist/` wordt aangemaakt of bijgewerkt, geen errors.

#### Stap 3 — Frontend bouwen

```
cd client
npm install
npm run build
cd ..
```

Verwacht resultaat: map `client/build/` wordt aangemaakt of bijgewerkt.

#### Stap 4 — Opstarten

Open **twee** Command Prompt-vensters naast elkaar:

**Venster 1 — Backend**
```
cd "pad\naar\device-activity-tracker-master"
node dist/server.js
```

**Venster 2 — Frontend (development server)**
```
cd "pad\naar\device-activity-tracker-master\client"
npm start
```

Of serve de productiebuild via een statische server:
```
npx serve -s client/build -l 3000
```

Frontend bereikbaar op: http://localhost:3000
Backend bereikbaar op: http://localhost:3001

#### (Optioneel) Signal API

Alleen nodig als je Signal-tracking wilt gebruiken:
```
docker run -d -p 8080:8080 -e MODE=json-rpc bbernhard/signal-cli-rest-api
```

---

## 4. Wat betekenen de statussen?

| Status | Kleur | Betekenis |
|---|---|---|
| **Online** | 🟢 Groen | WhatsApp staat open en actief op het apparaat. De gebruiker heeft de app op de voorgrond. |
| **Standby** | 🟡 Geel | Het apparaat is aan en bereikbaar (internet actief), maar WhatsApp staat niet op de voorgrond. |
| **Offline** | 🔴 Rood | Geen reactie op probes. Telefoon is waarschijnlijk uit, heeft geen internet, of staat in vliegtuigmodus. |
| **Aan het typen** | 🔵 Blauw | WhatsApp-presence meldt dat de gebruiker op dit moment typt. |
| **Gestopt met typen** | 🟣 Paars | Gebruiker is gestopt met typen, maar heeft het bericht nog niet verstuurd. |
| **Kalibreren...** | ⚪ Grijs | Tracker verzamelt de eerste meetgegevens. Wacht enkele seconden. |

### Wat meten de getallen?

| Waarde | Betekenis |
|---|---|
| **Current Avg RTT** | Gemiddelde reactietijd van de laatste 3 metingen in milliseconden. Lager = apparaat reageert sneller = waarschijnlijk actief. |
| **Median** | Middelste waarde van alle metingen. Stabiel basisniveau, niet beïnvloed door uitschieters. Basis voor de Threshold. |
| **Threshold** | Drempelwaarde = Median × 1.2. Reageert het apparaat binnen dit getal → Standby. Geen reactie → Offline. Online wordt bepaald door WhatsApp-presence. |

---

## 5. Bekende beperking: Online niet zichtbaar

Als de "Official Status" kolom **Unknown** toont, ontvangt de tracker **geen presence-events** van WhatsApp voor dit contact.

**Meest waarschijnlijke oorzaak:**
Het contact heeft in WhatsApp de privacyinstelling **"Laatste gezien en online"** ingesteld op *Niemand* of *Mijn contacten*, waardoor jij hun online-status niet ontvangt.

**Gevolg:**
De tracker kan in dat geval alleen onderscheid maken tussen:
- **Standby** (apparaat reageert op probes → bereikbaar)
- **Offline** (geen reactie → niet bereikbaar)

**Online** vereist dat WhatsApp de presence deelt. Dit is een WhatsApp-privacybeperking en geen bug in de tool.

---

*Update samengesteld op 2026-03-24*
