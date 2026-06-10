# Yard-Management als eigene App — Analyse & Umsetzungskonzept

> Recherche- und Konzeptdokument. Vorbild/Benchmark: **SDBN „TMC Yard"**
> (https://www.sdbn-solutions.de/produkte/yardmanagement/).
> Zielintegration: **Microsoft Dynamics 365 Business Central (BC 365)**.
> Stand: 2026-06. Erstellt im Rahmen einer Deep-Research-Analyse (6 parallele Recherche-Agenten + Verifikation).

---

## Inhalt
1. [Executive Summary](#1-executive-summary)
2. [Wie das Vorbild (SDBN TMC Yard) funktioniert](#2-wie-das-vorbild-sdbn-tmc-yard-funktioniert)
3. [Funktionsumfang: Standard vs. Differenzierung](#3-funktionsumfang-standard-vs-differenzierung)
4. [Markt & Wettbewerb](#4-markt--wettbewerb)
5. [Machbarkeit & Empfohlene Architektur (MVP)](#5-machbarkeit--empfohlene-architektur-mvp)
6. [Datenmodell der Yard-App](#6-datenmodell-der-yard-app)
7. [Business-Central-Integration: Datenmodell & API-Mapping](#7-business-central-integration-datenmodell--api-mapping)
8. [End-to-End-Sequenzfluss](#8-end-to-end-sequenzfluss)
9. [Build vs. Buy — Bausteine](#9-build-vs-buy--bausteine)
10. [Phasen-Roadmap & Kostenplan](#10-phasen-roadmap--kostenplan)
11. [Risiken & offene Entscheidungen](#11-risiken--offene-entscheidungen)
12. [Quellen & Konfidenz](#12-quellen--konfidenz)

---

## 1. Executive Summary

**Was es ist.** SDBNs Produkt heißt **„TMC Yard"** (Teil der Suite *„TMC – Traffic, Management & Control"*). Es digitalisiert die **Hoflogistik** zwischen Werkstor und Laderampe: Zeitfensterbuchung (`TMC TIME`), Self-Check-in, Tor-/Schrankensteuerung, Kennzeichenerkennung, Stellplatzverwaltung und Fahrerkommunikation (`SDBN Global Connect`) — mit einem KI-„**Yard Assistant**", der Aufträge priorisiert und Tore zuweist.

**Kann man das selbst bauen?**

| Ausbaustufe | „Einfach?" | Aufwand (grob) |
|---|---|---|
| Schlankes Zeitfenster-/Hof-Tool + BC-Anbindung | **Ja, gut machbar** | 3–5 Monate, ~30–70k € |
| TMC-Yard-Äquivalent (KI-Assistent, ANPR/Schranke, Fahrer-App, Echtzeit-Yard) | Machbar, aber echtes Produkt | 9–18 Monate, ~120–250k €+ |

**Schlüsselbefund für die BC-Integration:** Business Central hat **kein natives Yard-Management**. BCs Lagermodul endet *innerhalb* des Lagers (Wareneingang → Bin → Pick → Versand). Der Bereich **Tor ↔ Hof ↔ Rampe** fehlt — genau diese Lücke füllt die App. BC liefert dafür alle Integrationsbausteine (REST-API `api/v2.0`, Webhooks, OAuth S2S), und im empfohlenen Architekturmuster (**externe App ruft BC an**) wird **kein AL-Entwickler** benötigt.

---

## 1a. ⭐ TATSÄCHLICH BENÖTIGTER SCOPE: Rampen-/Zeitfensterbuchung

> **Nach Klärung:** Benötigt wird **nur das Rampenmanagement** — Lieferanten melden sich an und wählen selbst ein freies **Zeitfenster** an einer Rampe.
> Das entspricht der Produktkategorie **Dock Appointment Scheduling / Zeitfenstermanagement** (wie **Cargoclix SLOT**, **LOGSOL RampMan**) — also nur der „Standard"-Kern aus Abschnitt 3, **ohne** Yard-Funktionen (kein ANPR, keine Schranke, keine Stellplatzverwaltung, kein Yard Assistant, keine Fahrer-App).
> Die Abschnitte 2–12 bleiben als **Hintergrund/Benchmark** stehen; maßgeblich für die Umsetzung ist dieser Abschnitt 1a.

### Kernfunktionen (vollständig für diesen Scope)

**Lieferant (Self-Service):**
- Registrierung/Login (Account **oder** Einladungs-/Magic-Link)
- Rampe + Datum wählen → freie Zeitfenster sehen
- Zeitfenster buchen (mit Referenz/Bestell-Nr., Menge, Avis-Daten)
- eigene Buchungen einsehen/ändern/stornieren
- Bestätigung + Erinnerung (E-Mail/SMS)

**Standort/Verlader (Admin):**
- Rampen & Öffnungszeiten konfigurieren
- Slot-Raster je Rampe (Dauer, Kapazität, Pufferzeiten, Sperr-/Feiertage)
- Buchungskalender (Tages-/Wochenansicht), umbuchen/sperren
- No-Show/Verspätung markieren, einfache KPIs (Auslastung, Pünktlichkeit)
- Benutzer-/Lieferantenverwaltung

**System:**
- **Doppelbuchungs-/Konfliktvermeidung VOR Bestätigung** (Kernlogik)
- Benachrichtigungen (E-Mail/SMS)
- optionale BC-Anbindung (s. u.)

### Reduziertes Datenmodell
`sites`, `ramps` (=docks), `availability_rules`, `time_slots`, `bookings`, `carriers` (=Lieferanten, opt. `bc_vendor_no`), `users`/`roles`, `notifications`.
→ **Entfällt** ggü. Voll-YMS: `yard_positions`, `visits`, `visit_events`, `weighings`, Gate-/Hardware-Logik.

### BC-Integration (optional, schlank)
- **Standalone (ohne BC):** sofort lauffähig.
- **BC lesend:** Lieferanten-/Bestelldaten ziehen, damit die Buchung mit einer echten **Bestell-Nr.** verknüpfbar ist → `vendors`, `purchaseOrders`.
- **BC schreibend (optional):** gebuchtes/erreichtes Zeitfenster zurückmelden (Custom API/Power-Automate-Flow).

### Aufwand (nur dieser Scope)
| Variante | Dauer | Kosten (grob) |
|---|---|---|
| MVP Standalone (Eigenbau) | ~6–10 Wochen | ~15–35k € |
| + BC-Anbindung (lesend) | +2–3 Wochen | +5–10k € |
| **Buy-Alternative** (Cargoclix SLOT: 0,50 €/Buchung, keine Monatsgebühr; LOGSOL RampMan) | Tage–Wochen | nutzungs-/abobasiert |

> **Empfehlung:** Da fertige Tools (Cargoclix/RampMan) **exakt** diesen Scope abdecken, lohnt eine ehrliche **Build-vs-Buy-Prüfung**. Eigenbau lohnt v. a. wegen (a) tiefer **BC-365-Integration**, (b) eigenem Branding/UX, (c) Datenhoheit, (d) Vermeidung von Pro-Buchung-Kosten bei hohem Volumen.

---

## 2. Wie das Vorbild (SDBN TMC Yard) funktioniert

### 2.1 Produktsuite

| Modul | Funktion |
|---|---|
| **TMC Yard** | Kern: Torsteuerung, Stellplatzverwaltung, Truck-Routing, **Yard Assistant** (KI) |
| **TMC TIME** | Cloud-**Zeitfenstermanagement** — Spediteure buchen Slots selbst, 24/7 |
| **SDBN Global Connect** | **Fahrer-App** (iOS/Android, gratis) — Anweisungen per App/SMS, Auto-Übersetzung, QR-Onboarding |
| **Online-Terminal** | Web-Terminal (`terminal.tmc-yard.de`) |

### 2.2 Funktionsmodule
- Digitale Tor-/Schranken-/Ampelsteuerung
- Stellplatzverwaltung & Truck-Routing
- **Yard Assistant (KI):** priorisiert Verlade-/Rangieraufträge, weist Tore dynamisch nach Auslastung zu, „regelbasierte Entscheidungen"
- Self-Check-in über mehrsprachige Selbstbedienungs-Terminals
- Wäge- & Verladestationen, Lieferschein-Erfassung & Dokumentdruck
- Durchgängige, „DSGVO-konforme" Dokumentation

### 2.3 Hardware
| Hardware | Pflicht? |
|---|---|
| Selbstanmelde-Terminals | optional (Alt.: Smartphone) |
| ANPR-Kameras (Kennzeichen) | optional (Alt.: QR/RFID) |
| Schranken/Ampeln | optional (nur bei Automatisierung) |
| Mobile App | Kern (Global Connect) |
| Waage-Anbindung | optional |

> **Merksatz:** Ein Grund-YMS braucht *technisch keine* Spezial-Hardware. ANPR + Schranke sind Automatisierungs-„Kür".

### 2.4 Eckdaten
- **Architektur:** Cloud/SaaS, modular, Web-Portal + native Apps.
- **Schnittstellen:** generisch „ERP/TMS/WMS" (SAP/Telematik **nicht** namentlich belegt).
- **Firma:** SDBN Solutions GmbH, Karlsruhe, GmbH gegr. ~2015, Yard-Fokus seit 2016, 3 Gründer.
- **Preis:** nicht öffentlich (Demo-/Kontaktvertrieb).

---

## 3. Funktionsumfang: Standard vs. Differenzierung

| ✅ Standard / „Muss" (Commodity) | ⭐ Fortgeschritten / „Kür" (Differenzierung) |
|---|---|
| Gate-Management, Check-in/Check-out | Automatisches Gate mit **ANPR/OCR-KI** |
| Zeitfenster-/Slot-Buchung (Self-Service) | **KI-Optimierung** der Tür-/Sequenzzuweisung |
| Stellplatz-/Trailer-Bestand + Status | Echtzeit-Ortung via **GPS/RFID/IoT** |
| Yard-Moves / Rangier-Disposition | Prädiktive/autonome Yard-Moves |
| Echtzeit-Sichtbarkeit (Dashboard) | Computer-Vision (Siegel-/Schadenserkennung) |
| Fahrer-Self-Service (App/SMS/Kiosk) | Waage-/Verladesteuerungs-Integration |
| KPIs (Dwell Time, Detention/Demurrage) | Fortgeschrittene Analytics |
| ERP/TMS/WMS-Integration | — |

→ SDBNs Alleinstellung = **Yard Assistant (KI)** + integrierte Fahrer-App mit Auto-Übersetzung. Reine Zeitfenster-/Gate-Funktionen sind kommoditisiert.

---

## 4. Markt & Wettbewerb

Markt **zweigeteilt**:
- **Globale Schwergewichte:** Kaleris/PINC, Manhattan Active Yard, Blue Yonder, FourKites, **SAP Yard Logistics** (Enterprise-TCO, oft >100k €/Jahr).
- **Schlanke DACH-Punktlösungen (Vergleichsgruppe):** LOGSOL RampMan, **Cargoclix SLOT**, PAARI titan, INFORM SYNCROSUPPLY.
- **Plattform mit Carrier-Netz:** Transporeon (von Trimble für ~1,88 Mrd. € übernommen).

**Preismodelle:**
1. **Transaktionsbasiert** — Cargoclix: **0,50 €/Buchung**, keine Monatsgebühr *(verifiziert)*
2. **SaaS-Abo** — pro Standort + Einrichtung
3. **Enterprise-Lizenz** — Vertragspreis, hoher TCO

> Es existiert **kein vollwertiges Open-Source-YMS** — der Markt ist proprietär. (Der *Buchungskern* dagegen ist als OSS verfügbar, s. Abschnitt 9.)

---

## 5. Machbarkeit & Empfohlene Architektur (MVP)

### 5.1 Architekturmuster: „Externe App ruft BC an" (lose Kopplung — empfohlen)

```
┌──────────────────────────────┐       REST api/v2.0 (OAuth2 S2S)      ┌────────────────────┐
│        YARD-APP              │  ───────────────────────────────────▶ │  BUSINESS CENTRAL  │
│                             │     GET  Lieferanten, Bestellungen,    │       365 (SaaS)   │
│  ┌────────────┐ ┌─────────┐  │          Artikel, Lieferungen          │                    │
│  │ Web-Portal │ │ Fahrer- │  │     POST Wareneingang, Status          │  ┌──────────────┐  │
│  │ (Next.js)  │ │ App/QR  │  │  ◀───────────────────────────────────  │  │ Std-API v2.0 │  │
│  └────────────┘ └─────────┘  │        Webhooks (Push bei Änderung)    │  │ + Custom API │  │
│  ┌────────────────────────┐  │                                        │  │   (opt. AL)  │  │
│  │ Backend + Supabase/PG  │  │                                        │  └──────────────┘  │
│  │ (eigene Yard-Daten)    │  │                                        └────────────────────┘
│  └────────────────────────┘  │
│  ┌────────────────────────┐  │   optional, je nach Automatisierung
│  │ Integrationsadapter    │  │ ───▶ ANPR-SDK · Schranke · SMS/Push · Waage
│  └────────────────────────┘  │
└──────────────────────────────┘
```

**Warum dieses Muster:** kein AL-Entwickler nötig (reines Backend + OAuth), freie Tech-/UI-Wahl, unabhängig vom BC-Release-Zyklus; Yard-Endnutzer brauchen i. d. R. **keine** eigene BC-User-Lizenz (Lizenzfrage final mit MS-Partner klären). Nachteil: Daten-Sync selbst bauen, Rate-Limits beachten.

*Alternative „Muster 2" (App als AL-Extension IN BC):* native Transaktionen, aber AL-Pflicht, BC-Lizenz je Bearbeiter, weniger UI-Freiheit. Nur bei tiefem Eingriff in BC-Belege sinnvoll.

### 5.2 Tech-Stack-Empfehlung
| Schicht | Empfehlung |
|---|---|
| Frontend | Next.js (React) |
| Backend | Node.js / Next.js API-Routes |
| DB | PostgreSQL + Prisma (Row-Level-Security) |
| Plattform | Supabase (Auth, Realtime, RLS, Edge Functions) |
| Echtzeit | WebSockets (Socket.io) |
| Mobile (später) | React Native / Flutter |
| Buchungskern | Cal.com / Easy!Appointments (Lizenz prüfen!) |

### 5.3 MVP-Scope (Phase 1)
```
✓ Zeitfenster-Buchung (Lieferanten-Portal, Konfliktvermeidung VOR Buchung)
✓ Benutzer-/Rollenverwaltung (Multi-Site optional)
✓ Self-Check-in per QR/Smartphone (statt teurer Terminals)
✓ Echtzeit-Status-Board (wer ist wo, welcher Status)
✓ Benachrichtigungen (E-Mail/SMS)
✓ BC-365-Anbindung (Lieferanten/Bestellungen lesen, Wareneingang melden)
✗ NOCH NICHT: ANPR/Schranke, KI-Assistent, native Fahrer-App
```

---

## 6. Datenmodell der Yard-App

> **Grundprinzip:** Der **Yard-Zustand** (Slots, Visits, Stellplätze) lebt in der **eigenen DB** der App — *nicht* in BC. Nur die Integrations-Berührungspunkte (Bestellungen, Wareneingänge) werden mit BC synchronisiert.

| Tabelle | Zweck | Wichtige Felder |
|---|---|---|
| `sites` | Standorte/Werke (Mandant) | id, name, timezone |
| `gates` | Tore | id, site_id, name, type (in/out/both) |
| `docks` | Rampen/Türen | id, site_id, name, allowed_handling |
| `yard_positions` | Stellplätze | id, site_id, code, status (frei/belegt) |
| `resources` | buchbare Ressource (Dock/Slot-Pool) | id, site_id, dock_id, capacity |
| `availability_rules` | Öffnungszeiten/Slot-Raster | resource_id, weekday, from, to, slot_minutes |
| `time_slots` | konkrete buchbare Fenster | id, resource_id, start, end, status |
| `bookings` | Buchung eines Slots | id, slot_id, carrier_id, **bc_document_type**, **bc_document_no**, direction (inbound/outbound), status |
| `carriers` | Spediteure/Lieferanten | id, name, **bc_vendor_no** (Link zu BC) |
| `drivers` | Fahrer | id, carrier_id, name, lang, phone |
| `visits` | Hofbesuch (Check-in→out) | id, booking_id, plate, checkin_at, gate_in, position_id, status, checkout_at |
| `visit_events` | Statushistorie/Audit | id, visit_id, type, payload, created_at |
| `weighings` | Verwiegung (optional) | id, visit_id, weight_kg, source |
| `notifications` | Benachrichtigungen | id, visit_id, channel, template, sent_at |
| `users` / `roles` | Auth/Rollen | id, site_id, role (admin/yard/gate/viewer) |
| `bc_sync_log` | Sync-Status zu BC | id, entity, bc_id, direction, status, last_synced_at |

**Status-Maschine `visits`:**
```
BOOKED → ARRIVED → CHECKED_IN → ASSIGNED(position/dock) → LOADING/UNLOADING
       → WEIGHED(opt) → GOODS_POSTED(→BC) → CHECKED_OUT
```

---

## 7. Business-Central-Integration: Datenmodell & API-Mapping

### 7.1 Lesen AUS BC (Stammdaten/Belege, treiben den Hof)

| Yard-Objekt | BC-Standard-API (`api/v2.0`) | Zweck |
|---|---|---|
| `carriers` | `vendors` | Lieferant/Carrier-Stammdaten |
| Kundenabholungen | `customers` | Empfänger bei Outbound |
| Erwartete Inbounds | `purchaseOrders` (+ Zeilen) | Slot-Buchung gegen Bestellung |
| Erwartete Outbounds | `salesOrders` (+ Zeilen) | Slot-Buchung gegen Verkaufsauftrag |
| Artikel | `items` | Positions-/Mengenanzeige |
| Standorte | `locations` | Standort-/Site-Zuordnung |
| Firmenkontext | `companies` | Mandanten-/Company-Id (Pflicht in URL) |

> Endpoint-Form (SaaS): `https://api.businesscentral.dynamics.com/v2.0/<environment>/api/v2.0/companies(<id>)/<entity>`

### 7.2 Schreiben IN BC (Yard-Ereignisse zurück)

| Yard-Ereignis | Ziel in BC | Weg |
|---|---|---|
| Wareneingang bestätigt | Warehouse/Purchase Receipt | **Custom API (AL)** oder Power-Automate-Flow, da Buchungslogik |
| Check-in/Ankunftszeit | Custom-Feld/Tabelle | Custom API (AL) — optional |
| Verwiegung | Custom-Feld | Custom API (AL) — optional |
| Statusmeldung | Custom-Tabelle | Custom API (AL) — optional |

> **Wichtig:** Lesen geht meist mit **Standard-APIs ohne AL**. Sobald man Belege in BC **bucht/anlegt** (z. B. Wareneingang verbuchen), braucht man entweder eine **Custom API (AL-Entwickler)**, einen **Power-Automate-Flow**, oder man nutzt eine geeignete Standard-Aktion. Yard-spezifische Daten (Slot, Stellplatz, Check-in) gehören **nicht** nach BC — sie bleiben in der Yard-App; nur logistisch relevante Buchungen werden gespiegelt.

### 7.3 Auth & Betrieb (verifiziert)
- **OAuth 2.0 / Entra ID**, **S2S Client-Credentials** für Backend; App zusätzlich *in BC* berechtigen. Scopes: `API.ReadWrite.All`, ggf. `Automation.ReadWrite.All`.
- **Rate Limits:** **6.000 Requests / 5 Min., 5 parallel, pro User** → bei **HTTP 429** Retry mit Backoff (`Retry-After` beachten); `$batch` (Writes), `$expand` (Reads), **Webhooks statt Polling**, `Data-Access-Intent: ReadOnly` für Reports.
- **Webhooks:** Push bei Änderung; **Subscription erlischt nach 3 Tagen** → per PATCH erneuern; Validation-Handshake (validationToken zurückgeben).
- **Request-Timeout:** 10 Min. (sonst HTTP 504).
- **SaaS-Updates:** mehrmals/Jahr erzwungen → Integration muss mitziehen.

---

## 8. End-to-End-Sequenzfluss

```
Lieferant            Yard-App                 BC 365                Hof-Hardware (opt.)
   │                    │                        │                       │
   │  öffnet Portal     │  GET purchaseOrders ──▶│                       │
   │ ◀── freie Slots ───│ ◀── offene Bestellung ─│                       │
   │  bucht Slot ──────▶│  (Konfliktprüfung)     │                       │
   │ ◀── Bestätigung+QR │                        │                       │
   │                    │                        │                       │
   │  Ankunft ─────────────────────────────────────────────────▶ ANPR/QR
   │                    │ ◀── Kennzeichen/QR ─────────────────────────── │
   │                    │  match Buchung         │                       │
   │                    │  Schranke öffnen ──────────────────────▶ Schranke
   │                    │  Stellplatz/Tor zuweisen (Assistant)   │       │
   │ ◀── Anweisung (SMS/App, auto-übersetzt) ──  │                       │
   │  Be-/Entladung     │                        │                       │
   │                    │  Wareneingang ─POST───▶│ (Custom API/Flow)     │
   │  Ausfahrt ────────────────────────────────────────────────▶ ANPR
   │                    │  Visit CHECKED_OUT     │                       │
   │                    │  Doku/KPIs speichern   │                       │
```

---

## 9. Build vs. Buy — Bausteine

Prinzip: **„Commodity kaufen, Differenzierung bauen."**

| Baustein | Empfehlung |
|---|---|
| Slot-/Buchungslogik | **Wiederverwenden** (Cal.com / Easy!Appointments) — Lizenz (AGPL) prüfen |
| Kennzeichenerkennung | **Zukaufen** (z. B. Plate Recognizer, Cloud/On-Prem-SDK ~75 $/Mon. für 50k Lookups). Nie selbst bauen. |
| Schranken-Anbindung | Hardware-**SDK/API** |
| Maps/Routing | Google Maps / Leaflet (OSS) |
| SMS/Push | Twilio (~0,0083 $/SMS) / Firebase (Push gratis) |
| Multi-Tenant-Gerüst | Boilerplate (MakerKit / supastarter) |
| **Yard-Workflow + KI-Logik** | **selbst bauen** (Differenzierungskern) |

---

## 10. Phasen-Roadmap & Kostenplan

> Kostenangaben = Orientierung aus Branchen-/Agenturquellen (Verkaufsinteresse → eher Bandbreiten). Stundensätze: West-EU 75–150+ $/h, Osteuropa/LatAm 25–75 $/h.

| Phase | Inhalt | Dauer | Kosten (grob) |
|---|---|---|---|
| **0 — Discovery** | Prozessaufnahme am Hof, BC-Entitäten/Felder mappen, Lizenz-/DSGVO-Check | 2–4 Wo. | 5–15k € |
| **1 — MVP** | Web-Buchung + Rollen + QR-Check-in + Status-Board + BC-Lesen/Wareneingang | 3–5 Mon. | 30–70k € |
| **2 — Fahrer & Echtzeit** | Fahrer-App/PWA, SMS/Push, Echtzeit-Yard-Board, KPIs | +3–4 Mon. | +40–80k € |
| **3 — Hardware-Automatik** | ANPR-SDK + Schranke + (Waage) je Standort | +2–3 Mon. | +25–50k € + HW |
| **4 — „Yard Assistant"** | Regelbasierte Tor-/Auftragszuweisung → später KI-Optimierung | +3–6 Mon. | +40–90k € |

**Laufende Kosten (Beispiele):** Hosting/Supabase (Tarif-abhängig), Twilio-SMS (~0,0083 $/Nachricht), ANPR-SDK (~75 $/Mon.), BC-Lizenzen nach Named-User (Essentials ~80 $/User/Mon. — nur falls Nutzer *in* BC arbeiten), Wartung (regelmäßig unterschätzt!).

**Hardware-Richtwerte:** ANPR-Kamera ~750–1.500 $ (Mittelklasse, bis >20k $ High-End); Schrankensystem projektabhängig.

---

## 11. Risiken & offene Entscheidungen

**Risiken**
- ⚠️ Wartungs-/Integrationsaufwand wird regelmäßig unterschätzt; IT-Projekte überziehen typisch (~45 % über Budget).
- ⚠️ Hardware-Integration vor Ort (ANPR/Schranke/Waage) ist erfahrungsgemäß der unsicherste Posten.
- ⚠️ BC-Rate-Limits & erzwungene SaaS-Updates erfordern robuste Sync-/Retry-Logik.
- ⚠️ DSGVO: Kennzeichen = personenbezogene Daten → Hinweispflicht, ggf. DSFA; Fahrer-/Personaldaten beachten.

**Offene Entscheidungen (vor Phase 1 klären)**
- [ ] Lizenzpflicht bei reinem S2S-/API-Zugriff auf BC — **mit MS-Partner verifizieren**.
- [ ] Wareneingang in BC: Custom API (AL-Entwickler) **oder** Power-Automate-Flow?
- [ ] Multi-Site/Multi-Tenant von Anfang an, oder Single-Site-MVP?
- [ ] Buchungskern: OSS wiederverwenden (Lizenz!) **oder** selbst bauen?
- [ ] Hardware-Ausbau: welche Standorte, welcher Automatisierungsgrad zuerst?

---

## 12. Quellen & Konfidenz

**Hoch (verifiziert / mehrfach belegt):**
- SDBN TMC Yard / Yard Assistant: sdbn-solutions.de, pressebox.de, prweb.de (PM 15.01.2026)
- BC-Limits & APIs: learn.microsoft.com (api-reference v2.0, rate-limits, subscriptions, S2S-auth), skuno.ai, demiliani.com
- Cargoclix-Preis (0,50 €/Buchung): start.cargoclix.com, transport-online.de
- Wettbewerber: transporeon.com, kaleris.com, manh.com, blueyonder.com, inform-software.com, logsol.de, sap.com
- OSS-Bausteine: github.com/calcom, github.com/alextselegidis/easyappointments, platerecognizer.com

**Mittel (Anbieter-/Sekundärquellen):** Kosten-/Zeitschätzungen (Agentur-Blogs: ptolemay.com, appwrk.com, saigontechnology.com u. a.), Marktgrößen (divergieren stark je Definition).

**Einschränkung:** Die SDBN-Originalseiten waren per Bot-Schutz (HTTP 403) **nicht direkt** abrufbar — SDBN-Fakten stammen aus Suchmaschinen-Snippets der Originaltexte/Pressemitteilungen. Vor einer belastbaren Investitions-/Pitch-Grundlage: SDBN-Seiten im Browser prüfen, BC-Lizenzfrage mit MS-Partner final klären, OData-UI-Page-Deprecation (BC v30 / 2027 Wave 1) und tagesaktuelle BC-Preise gegenchecken.
