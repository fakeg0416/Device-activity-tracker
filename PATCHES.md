# Device Activity Tracker — Alle wijzigingen t.o.v. origineel

> Dit document beschrijft **exact** welke regels zijn aangepast ten opzichte van de originele GitHub-versie
> (`https://github.com/gommzystudio/device-activity-tracker`).
> Per bestand staat: wat er stond → wat het nu moet zijn, inclusief de reden.

---

## Overzicht gewijzigde bestanden

| Bestand | Soort wijziging |
|---|---|
| `src/server.ts` | Fix: Baileys ESM-import, WhatsApp opnieuw verbinden na logout, log-niveau |
| `src/tracker.ts` | Fix + verbetering: snellere probes, presence-gebaseerde statusdetectie, bugfix OFFLINE→Online |
| `client/src/components/Login.tsx` | Fix: Signal QR-code verloopt niet meer na 25 seconden |
| `client/src/components/ContactCard.tsx` | Verbetering: tooltips, statuslegenda, Composing/Paused/Online detectie |

---

## 1. `src/server.ts`

### Wijziging 1 — Baileys import (ESM-compatibiliteit)

**Probleem:** De originele import werkte niet op Node 20+ met ES modules, waardoor de WhatsApp-verbinding mislukte.

**Zoek (origineel):**
```ts
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
```

**Vervang door:**
```ts
import _pkg, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
const makeWASocket = (_pkg as any).default ?? _pkg;
import { rmSync } from 'fs';
```

---

### Wijziging 2 — WhatsApp socket aanmaken met versiecheck

**Probleem:** Zonder versiecheck gebruikte Baileys een verouderde protocolversie, waardoor de QR-code niet altijd verscheen.

**Zoek (origineel):**
```ts
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'debug' }),
        markOnlineOnConnect: true,
        printQRInTerminal: false,
    });
```

**Vervang door:**
```ts
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        markOnlineOnConnect: true,
        printQRInTerminal: false,
    });
```

---

### Wijziging 3 — Herverbinden na uitloggen

**Probleem:** Als de sessie verlopen was (loggedOut), verbond de tool zichzelf niet opnieuw en verscheen er geen nieuwe QR-code.

**Zoek (origineel):**
```ts
        if (connection === 'close') {
            isWhatsAppConnected = false;
            currentWhatsAppQr = null; // Clear QR on close
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('connection closed, reconnecting ', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        }
```

**Vervang door:**
```ts
        if (connection === 'close') {
            isWhatsAppConnected = false;
            currentWhatsAppQr = null;
            const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
            const loggedOut = statusCode === DisconnectReason.loggedOut;
            console.log('connection closed, statusCode:', statusCode, 'loggedOut:', loggedOut);

            if (loggedOut) {
                // Clear stale auth so a fresh QR is generated
                try {
                    rmSync('auth_info_baileys', { recursive: true, force: true });
                    console.log('Auth state cleared, reconnecting for new QR...');
                } catch (e) {
                    console.log('Could not clear auth state:', e);
                }
            }
            // Always reconnect — either resume session or show fresh QR
            setTimeout(() => connectToWhatsApp(), 1000);
        }
```

---

## 2. `src/tracker.ts`

### Wijziging 1 — `normalizeJid` methode toevoegen

**Reden:** Voorkomt dat device-JIDs (bv. `3161234:1@s.whatsapp.net`) als aparte apparaten worden bijgehouden. Alles wordt teruggebracht naar het hoofd-JID.

**Voeg toe** direct na de `getProbeMethod` methode (na regel `return this.probeMethod;`):

```ts
    /**
     * Normalize any device JID back to the canonical targetJid.
     */
    private normalizeJid(_jid: string): string {
        return this.targetJid;
    }
```

---

### Wijziging 2 — Presence-handler: status direct bijwerken

**Reden:** Origineel werd de presence alleen opgeslagen maar niet vertaald naar een apparaatstatus. Hierdoor bleef de status op "Standby" staan ook al was iemand Online.

**Zoek (origineel):**
```ts
        // Listen for presence updates
        this.sock.ev.on('presence.update', (update) => {
            trackerLogger.debug('[PRESENCE] Raw update received:', JSON.stringify(update, null, 2));

            if (update.presences) {
                for (const [jid, presenceData] of Object.entries(update.presences)) {
                    if (presenceData && presenceData.lastKnownPresence) {
                        // Track multi-device JIDs (including LID)
                        this.trackedJids.add(jid);
                        trackerLogger.debug(`[MULTI-DEVICE] Added JID to tracking: ${jid}`);

                        this.lastPresence = presenceData.lastKnownPresence;
                        trackerLogger.debug(`[PRESENCE] Stored presence from ${jid}: ${this.lastPresence}`);
                        break;
                    }
                }
            }
        });

        // Subscribe to presence updates
        try {
            await this.sock.presenceSubscribe(this.targetJid);
            trackerLogger.debug(`[PRESENCE] Successfully subscribed to presence for ${this.targetJid}`);
            trackerLogger.debug(`[MULTI-DEVICE] Currently tracking JIDs: ${Array.from(this.trackedJids).join(', ')}`);
        } catch (err) {
            trackerLogger.debug('[PRESENCE] Error subscribing to presence:', err);
        }
```

**Vervang door:**
```ts
        // Listen for presence updates
        this.sock.ev.on('presence.update', (update) => {
            trackerLogger.debug('[PRESENCE] Raw update received:', JSON.stringify(update, null, 2));

            if (update.presences) {
                for (const [jid, presenceData] of Object.entries(update.presences)) {
                    if (presenceData && presenceData.lastKnownPresence) {
                        this.trackedJids.add(jid);
                        const presenceValue = presenceData.lastKnownPresence as string;
                        this.lastPresence = presenceValue;
                        trackerLogger.debug(`[PRESENCE] ${jid} -> ${presenceValue}`);

                        // Normalize JID to avoid duplicate entries for same device
                        const normJid = this.normalizeJid(jid);

                        // Update device state directly from presence — this is the ground truth
                        const newState =
                            presenceValue === 'available' ? 'Online' :
                            presenceValue === 'composing' ? 'Online' :
                            presenceValue === 'paused' ? 'Online' :
                            'Standby'; // unavailable

                        if (!this.deviceMetrics.has(normJid)) {
                            this.deviceMetrics.set(normJid, {
                                rttHistory: [],
                                recentRtts: [],
                                state: newState,
                                lastRtt: 0,
                                lastUpdate: Date.now()
                            });
                        } else {
                            const m = this.deviceMetrics.get(normJid)!;
                            // Always allow 'available' presence to clear OFFLINE state
                            if (m.state !== 'OFFLINE' || newState === 'Online') {
                                m.state = newState;
                                m.lastUpdate = Date.now();
                            }
                        }
                        const emoji = newState === 'Online' ? '🟢' : '🟡';
                        trackerLogger.info(`\n${emoji} ${normJid} presence: ${presenceValue} → ${newState}\n`);
                        break;
                    }
                }
            }
            this.sendUpdate();
        });

        // Subscribe to presence updates and re-subscribe every 30s to keep it fresh
        const subscribeToPresence = async () => {
            try {
                await this.sock.presenceSubscribe(this.targetJid);
                trackerLogger.debug(`[PRESENCE] Subscribed to presence for ${this.targetJid}`);
            } catch (err) {
                trackerLogger.debug('[PRESENCE] Error subscribing to presence:', err);
            }
        };

        await subscribeToPresence();
        const presenceInterval = setInterval(() => {
            if (!this.isTracking) { clearInterval(presenceInterval); return; }
            subscribeToPresence();
        }, 30000);
```

---

### Wijziging 3 — Snellere probe-interval

**Reden:** Origineel wachtte de tool 2 seconden tussen probes. Dit vertraagde statusdetectie sterk.

**Zoek (origineel):**
```ts
            const delay = Math.floor(Math.random() * 100) + 2000;
```

**Vervang door:**
```ts
            const delay = Math.floor(Math.random() * 100) + 400;
```

---

### Wijziging 4 — Kortere probe-timeout

**Reden:** 10 seconden wachten op een reactie was te lang. Bij 400ms probe-interval is 3.5s een realistischere grens.

**Zoek (2× — in `sendDeleteProbe` én `sendReactionProbe`):**
```ts
                }, 10000); // 10 seconds timeout
```

**Vervang beide door:**
```ts
                }, 3500); // 3.5 seconds timeout
```

---

### Wijziging 5 — `markDeviceOffline`: JID normaliseren

**Zoek (origineel):**
```ts
    private markDeviceOffline(jid: string, timeout: number) {
        // Initialize device metrics if not exists
        if (!this.deviceMetrics.has(jid)) {
```

**Vervang door:**
```ts
    private markDeviceOffline(jid: string, timeout: number) {
        jid = this.normalizeJid(jid);
        // Initialize device metrics if not exists
        if (!this.deviceMetrics.has(jid)) {
```

---

### Wijziging 6 — `addMeasurementForDevice`: JID normaliseren + lagere RTT-drempel

**Zoek (origineel):**
```ts
    private addMeasurementForDevice(jid: string, rtt: number) {
        // Initialize device metrics if not exists
        if (!this.deviceMetrics.has(jid)) {
```

**Vervang door:**
```ts
    private addMeasurementForDevice(jid: string, rtt: number) {
        jid = this.normalizeJid(jid);
        // Initialize device metrics if not exists
        if (!this.deviceMetrics.has(jid)) {
```

Verderop in dezelfde functie:

**Zoek (origineel):**
```ts
        if (rtt <= 5000) {
```
**Vervang door:**
```ts
        if (rtt <= 3500) {
```

En de commentaarregel eronder:

**Zoek (origineel):**
```ts
        // If rtt > 5000ms, it means timeout - device is already marked as OFFLINE by markDeviceOffline()
```
**Vervang door:**
```ts
        // If rtt > 3500ms, it means timeout - device is already marked as OFFLINE by markDeviceOffline()
```

---

### Wijziging 7 — `determineDeviceState`: presence bepaalt Online/Standby (niet RTT)

**Reden:** RTT-vergelijking werkte niet betrouwbaar. Presence is de enige betrouwbare bron voor Online-status.

**Zoek (origineel) — het hele `if (this.globalRttHistory.length >= 3)` blok:**
```ts
        if (this.globalRttHistory.length >= 3) {
            const sorted = [...this.globalRttHistory].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;


            threshold = median * 0.9;

            if (movingAvg < threshold) {
                metrics.state = 'Online';
            } else {
                metrics.state = 'Standby';
            }
        } else {
            metrics.state = 'Calibrating...';
        }
```

**Vervang door:**
```ts
        if (this.globalRttHistory.length >= 3) {
            const sorted = [...this.globalRttHistory].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
            threshold = median * 1.2;

            // ONLY presence determines Online — RTT alone cannot distinguish
            // "actively using WhatsApp" from "phone receiving in background"
            if (this.lastPresence === 'available' || this.lastPresence === 'composing') {
                metrics.state = 'Online';
            } else if (this.lastPresence === 'unavailable' || this.lastPresence === 'paused') {
                metrics.state = 'Standby';
            } else {
                // No presence data (privacy settings) — device is reachable but status unknown
                metrics.state = 'Standby';
            }
        } else {
            if (this.lastPresence === 'available' || this.lastPresence === 'composing') {
                metrics.state = 'Online';
            } else {
                metrics.state = 'Calibrating...';
            }
        }
```

---

### Wijziging 8 — `sendUpdate`: threshold-factor + virtual entry + deviceCount

**Zoek (origineel):**
```ts
    private sendUpdate() {
        // Build devices array
        const devices = Array.from(this.deviceMetrics.entries()).map(([jid, metrics]) => ({
            jid,
            state: metrics.state,
            rtt: metrics.lastRtt,
            avg: metrics.recentRtts.length > 0
                ? metrics.recentRtts.reduce((a: number, b: number) => a + b, 0) / metrics.recentRtts.length
                : 0
        }));

        // Calculate global stats for backward compatibility
        const globalMedian = this.calculateGlobalMedian();
        const globalThreshold = globalMedian * 0.9;

        const data = {
            devices,
            deviceCount: this.trackedJids.size,
            presence: this.lastPresence,
```

**Vervang door:**
```ts
    private sendUpdate() {
        // Build devices array
        let devices = Array.from(this.deviceMetrics.entries()).map(([jid, metrics]) => ({
            jid,
            state: metrics.state,
            rtt: metrics.lastRtt,
            avg: metrics.recentRtts.length > 0
                ? metrics.recentRtts.reduce((a: number, b: number) => a + b, 0) / metrics.recentRtts.length
                : 0
        }));

        // If no RTT data yet but presence is known, show a virtual entry
        if (devices.length === 0 && this.lastPresence) {
            devices = [{
                jid: this.targetJid,
                state: this.lastPresence === 'available' ? 'Online' : 'Standby',
                rtt: 0,
                avg: 0
            }];
        }

        // Calculate global stats for backward compatibility
        const globalMedian = this.calculateGlobalMedian();
        const globalThreshold = globalMedian * 1.2;

        const data = {
            devices,
            deviceCount: this.deviceMetrics.size || (this.lastPresence ? 1 : 0),
            presence: this.lastPresence,
```

---

## 3. `client/src/components/Login.tsx`

### Wijziging 1 — Signal QR-code verloopt niet meer

**Probleem:** De Signal QR-code was na ~25 seconden verlopen maar de browser bleef de gecachte versie tonen. Hierdoor kon je de QR niet meer scannen.

**Zoek (origineel):**
```tsx
export function Login({ connectionState }: LoginProps) {

    return (
```

**Vervang door:**
```tsx
export function Login({ connectionState }: LoginProps) {
    const [signalQrTimestamp, setSignalQrTimestamp] = useState(Date.now());

    // Refresh Signal QR every 25 seconds so it doesn't expire before scanning
    useEffect(() => {
        if (!connectionState.signal && connectionState.signalApiAvailable) {
            const interval = setInterval(() => setSignalQrTimestamp(Date.now()), 25000);
            return () => clearInterval(interval);
        }
    }, [connectionState.signal, connectionState.signalApiAvailable]);

    // Build refreshed Signal QR URL
    const signalQrUrl = connectionState.signalQrImage
        ? connectionState.signalQrImage.split('&t=')[0] + `&t=${signalQrTimestamp}`
        : null;

    return (
```

Voeg ook de imports toe bovenaan het bestand (als ze er nog niet staan):

**Zoek (origineel):**
```tsx
import React from 'react';
```

**Vervang door:**
```tsx
import React, { useEffect, useState } from 'react';
```

**Zoek daarna (origineel) in het Signal QR-gedeelte:**
```tsx
                        {connectionState.signalQrImage ? (
                                <img
                                    src={connectionState.signalQrImage}
```

**Vervang door:**
```tsx
                        {signalQrUrl ? (
                                <img
                                    src={signalQrUrl}
```

---

## 4. `client/src/components/ContactCard.tsx`

Dit bestand is het meest uitgebreid gewijzigd. Vervang de volledige bestandsinhoud door de onderstaande versie.

> **Tip:** Kopieer de inhoud van het huidige `ContactCard.tsx` in je project — dat is al de correcte versie.
> Onderstaand is ter referentie de volledige finale inhoud.

<details>
<summary>Klik om de volledige inhoud van ContactCard.tsx te zien</summary>

```tsx
import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Square, Activity, Wifi, Smartphone, Monitor, MessageCircle, HelpCircle } from 'lucide-react';
import clsx from 'clsx';

type Platform = 'whatsapp' | 'signal';

interface TrackerData {
    rtt: number;
    avg: number;
    median: number;
    threshold: number;
    state: string;
    timestamp: number;
}

interface DeviceInfo {
    jid: string;
    state: string;
    rtt: number;
    avg: number;
}

interface ContactCardProps {
    jid: string;
    displayNumber: string;
    data: TrackerData[];
    devices: DeviceInfo[];
    deviceCount: number;
    presence: string | null;
    profilePic: string | null;
    onRemove: () => void;
    privacyMode?: boolean;
    platform?: Platform;
}

// Status explanations
const STATUS_DESCRIPTIONS: Record<string, { label: string; description: string }> = {
    'Online': {
        label: 'Online',
        description: 'WhatsApp is open and active op het apparaat. De gebruiker heeft de app op de voorgrond.'
    },
    'Standby': {
        label: 'Standby',
        description: 'Het apparaat is aan en bereikbaar (internet actief), maar WhatsApp staat niet op de voorgrond. De telefoon is aan maar de gebruiker is niet bezig in WhatsApp.'
    },
    'OFFLINE': {
        label: 'Offline',
        description: 'Geen reactie ontvangen. De telefoon is waarschijnlijk uitgeschakeld, heeft geen internet, of staat in vliegtuigmodus.'
    },
    'Composing': {
        label: 'Aan het typen',
        description: 'De gebruiker is op dit moment een bericht aan het typen in WhatsApp.'
    },
    'Paused': {
        label: 'Gestopt met typen',
        description: 'De gebruiker was een bericht aan het typen maar is ermee gestopt (bericht nog niet verstuurd).'
    },
    'Calibrating...': {
        label: 'Kalibreren...',
        description: 'De tracker verzamelt de eerste meetgegevens. Even geduld — na een paar seconden verschijnt de juiste status.'
    },
};

// Native title-based tooltip — works even inside overflow:hidden containers
function InfoTooltip({ text }: { text: string }) {
    return (
        <span title={text} className="inline-flex items-center cursor-help ml-0.5">
            <HelpCircle size={14} className="text-blue-400 hover:text-blue-600 transition-colors" />
        </span>
    );
}

function StatusBadge({ status, badgeClass }: { status: string; badgeClass: string }) {
    const info = STATUS_DESCRIPTIONS[status];
    return (
        <span
            className={clsx('px-3 py-1 rounded-full text-sm font-medium cursor-help', badgeClass)}
            title={info ? `${info.label}: ${info.description}` : status}
        >
            {info?.label ?? status}
        </span>
    );
}

export function ContactCard({
    jid,
    displayNumber,
    data,
    devices,
    deviceCount,
    presence,
    profilePic,
    onRemove,
    privacyMode = false,
    platform = 'whatsapp'
}: ContactCardProps) {
    const lastData = data[data.length - 1];
    const rawDeviceStatus = devices.length > 0
        ? (devices.find(d => d.state === 'OFFLINE')?.state ||
            devices.find(d => d.state.includes('Online'))?.state ||
            devices[0].state)
        : 'Unknown';

    // Presence takes priority for online/composing/paused
    const currentStatus =
        presence === 'composing' ? 'Composing' :
        presence === 'paused' ? 'Paused' :
        presence === 'available' ? 'Online' :
        rawDeviceStatus;

    const statusDotClass =
        currentStatus === 'OFFLINE' ? 'bg-red-500' :
        currentStatus === 'Composing' ? 'bg-blue-500' :
        currentStatus === 'Paused' ? 'bg-purple-500' :
        currentStatus.includes('Online') ? 'bg-green-500' :
        currentStatus === 'Standby' ? 'bg-yellow-400' : 'bg-gray-400';

    const statusBadgeClass =
        currentStatus === 'OFFLINE' ? 'bg-red-100 text-red-700' :
        currentStatus === 'Composing' ? 'bg-blue-100 text-blue-700' :
        currentStatus === 'Paused' ? 'bg-purple-100 text-purple-700' :
        currentStatus.includes('Online') ? 'bg-green-100 text-green-700' :
        currentStatus === 'Standby' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-700';

    const deviceStateBadgeClass = (state: string) =>
        state === 'OFFLINE' ? 'bg-red-100 text-red-700' :
        state === 'Composing' ? 'bg-blue-100 text-blue-700' :
        state === 'Paused' ? 'bg-purple-100 text-purple-700' :
        state.includes('Online') ? 'bg-green-100 text-green-700' :
        state === 'Standby' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-700';

    // Blur phone number in privacy mode
    const blurredNumber = privacyMode ? displayNumber.replace(/\d/g, '•') : displayNumber;

    return (
        <div className="bg-gradient-to-br from-white to-gray-50 rounded-xl shadow-lg border border-gray-200 overflow-hidden">
            {/* Header with Stop Button */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <span className={clsx(
                        "px-2 py-1 rounded text-xs font-medium flex items-center gap-1",
                        platform === 'whatsapp' ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                    )}>
                        <MessageCircle size={12} />
                        {platform === 'whatsapp' ? 'WhatsApp' : 'Signal'}
                    </span>
                    <h3 className="text-lg font-semibold text-gray-900">{blurredNumber}</h3>
                </div>
                <button
                    onClick={onRemove}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2 font-medium transition-colors text-sm"
                >
                    <Square size={16} /> Stop
                </button>
            </div>

            <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Status Card */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col items-center text-center">
                        <div className="relative mb-4">
                            <div className="w-32 h-32 rounded-full overflow-hidden bg-gray-100 border-4 border-white shadow-md">
                                {profilePic ? (
                                    <img
                                        src={profilePic}
                                        alt="Profile"
                                        className={clsx(
                                            "w-full h-full object-cover transition-all duration-200",
                                            privacyMode && "blur-xl scale-110"
                                        )}
                                        style={privacyMode ? {
                                            filter: 'blur(16px) contrast(0.8)',
                                        } : {}}
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                                        No Image
                                    </div>
                                )}
                            </div>
                            <div className={clsx(
                                "absolute bottom-2 right-2 w-6 h-6 rounded-full border-2 border-white",
                                statusDotClass
                            )} />
                        </div>

                        <h4 className="text-xl font-bold text-gray-900 mb-1">{blurredNumber}</h4>

                        <div className="flex items-center gap-2 mb-4">
                            <StatusBadge status={currentStatus} badgeClass={statusBadgeClass} />
                        </div>

                        <div className="w-full pt-4 border-t border-gray-100 space-y-2">
                            <div className="flex justify-between items-center text-sm text-gray-600">
                                <span className="flex items-center gap-1"><Wifi size={16} /> Official Status</span>
                                <span className="font-medium">{presence || 'Unknown'}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm text-gray-600">
                                <span className="flex items-center gap-1"><Smartphone size={16} /> Devices</span>
                                <span className="font-medium">{deviceCount || 0}</span>
                            </div>
                        </div>

                        {/* Status Legend */}
                        <div className="w-full pt-4 border-t border-gray-100 mt-4">
                            <h5 className="text-xs font-semibold text-gray-500 uppercase mb-2">Status uitleg</h5>
                            <div className="space-y-1.5 text-xs text-gray-600">
                                <div className="flex items-start gap-2">
                                    <span className="mt-0.5 w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                                    <span><strong>Online</strong> — WhatsApp open & actief</span>
                                </div>
                                <div className="flex items-start gap-2">
                                    <span className="mt-0.5 w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" />
                                    <span><strong>Standby</strong> — Telefoon aan, WhatsApp niet actief</span>
                                </div>
                                <div className="flex items-start gap-2">
                                    <span className="mt-0.5 w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                                    <span><strong>Offline</strong> — Geen reactie (telefoon uit / geen internet)</span>
                                </div>
                            </div>
                        </div>

                        {/* Device List */}
                        {devices.length > 0 && (
                            <div className="w-full pt-4 border-t border-gray-100 mt-4">
                                <h5 className="text-xs font-semibold text-gray-500 uppercase mb-2">Device States</h5>
                                <div className="space-y-1">
                                    {devices.map((device, idx) => (
                                        <div key={device.jid} className="flex items-center justify-between text-sm py-1">
                                            <div className="flex items-center gap-2">
                                                <Monitor size={14} className="text-gray-400" />
                                                <span className="text-gray-600">Device {idx + 1}</span>
                                            </div>
                                            <span className={clsx("px-2 py-0.5 rounded text-xs font-medium", deviceStateBadgeClass(device.state))}>
                                                {device.state}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Metrics & Chart */}
                    <div className="md:col-span-2 space-y-6">
                        {/* Metrics Grid */}
                        <div className="grid grid-cols-3 gap-4">
                            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                <div className="text-sm text-gray-500 mb-1 flex items-center gap-1">
                                    <Activity size={16} /> Current Avg RTT
                                    <InfoTooltip text="Round-Trip Time (gemiddeld van laatste 3 metingen): hoe lang het duurt tussen het versturen van een probe en de ontvangstbevestiging van het apparaat. Lager = apparaat reageert sneller = waarschijnlijk actief. Hoog of geen respons = apparaat is niet bereikbaar." />
                                </div>
                                <div className="text-2xl font-bold text-gray-900">{lastData?.avg.toFixed(0) || '-'} ms</div>
                            </div>
                            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                <div className="text-sm text-gray-500 mb-1 flex items-center gap-1">
                                    Median
                                    <InfoTooltip text="Mediaan RTT over alle metingen: de middelste waarde van alle gemeten reactietijden. Dit geeft een stabiel basisniveau — niet beïnvloed door korte uitschieters. Wordt gebruikt om de Threshold te berekenen." />
                                </div>
                                <div className="text-2xl font-bold text-gray-900">{lastData?.median.toFixed(0) || '-'} ms</div>
                            </div>
                            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                <div className="text-sm text-gray-500 mb-1 flex items-center gap-1">
                                    Threshold
                                    <InfoTooltip text="Drempelwaarde = Mediaan × 1.2. Als de RTT onder dit getal blijft én het apparaat reageert → Standby. Reageert het apparaat helemaal niet (timeout) → Offline. Online wordt uitsluitend bepaald door de WhatsApp-presence van de gebruiker." />
                                </div>
                                <div className="text-2xl font-bold text-blue-600">{lastData?.threshold.toFixed(0) || '-'} ms</div>
                            </div>
                        </div>

                        {/* Chart */}
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 h-[300px]">
                            <h5 className="text-sm font-medium text-gray-500 mb-4">RTT History & Threshold</h5>
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={data}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                    <XAxis dataKey="timestamp" hide />
                                    <YAxis domain={['auto', 'auto']} />
                                    <Tooltip
                                        labelFormatter={(t: any) => new Date(t).toLocaleTimeString()}
                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    />
                                    <Line type="monotone" dataKey="avg" stroke="#3b82f6" strokeWidth={2} dot={false} name="Avg RTT" isAnimationActive={false} />
                                    <Line type="step" dataKey="threshold" stroke="#ef4444" strokeDasharray="5 5" dot={false} name="Threshold" isAnimationActive={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
```

</details>

---

## Bouwen na de wijzigingen

Na het doorvoeren van alle wijzigingen moet de code opnieuw gebouwd worden.

### Met Docker (aanbevolen)

```
cd "pad\naar\device-activity-tracker-master"
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Handmatig

```
cd "pad\naar\device-activity-tracker-master"
npm run build
cd client
npm run build
cd ..
node dist/server.js
```

Frontend (apart venster):
```
cd "pad\naar\device-activity-tracker-master\client"
npx serve -s build -l 3000
```

---

*Patches gedocumenteerd op 2026-03-24*
