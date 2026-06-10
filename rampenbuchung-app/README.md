# RampSlot — Rampen-Zeitfensterbuchung

**RampSlot** ist eine schlanke Web-App für die **Buchung von Zeitfenstern an
Laderampen** (Dock Appointment Scheduling). Lieferanten/Spediteure melden sich
an und buchen selbst ein freies Zeitfenster an der passenden Rampe; die
Hof-/Werks-Administration verwaltet Rampen, Sperrzeiten und alle Buchungen und
behält Auslastung und No-Shows im Blick.

Die App läuft **komplett standalone im Browser** — kein Build, kein Server, keine
Abhängigkeiten. Daten liegen im `localStorage`. Ein optionaler Umstieg auf ein
echtes Backend (Supabase/PostgreSQL) ist dokumentiert und vorbereitet.

> **Scope (bewusst eng):** reines **Rampen- / Zeitfenstermanagement**. RampSlot
> deckt die Terminplanung am Tor/an der Rampe ab — **nicht** das volle
> Yard-/Hoflogistik-Spektrum (Schrankensteuerung, Kennzeichenerkennung,
> Stellplatzverwaltung, Fahrer-App). Diese Ausbaustufen sind im
> [Ausblick](#ausblick) skizziert.

---

## Schnellstart

1. Repository auschecken / herunterladen.
2. Die Datei **`index.html`** im Browser öffnen — einfach **doppelklicken**
   (läuft per `file://`, kein Webserver nötig).
3. Mit einem der **Demo-Logins** anmelden:

   | Rolle | E-Mail | Passwort |
   |---|---|---|
   | **Admin** (Hof-Administration) | `admin@demo.de` | `demo` |
   | **Lieferant** (Spedition) | `lieferant@demo.de` | `demo` |

   (Ein zweiter Lieferant `nord@demo.de` / `demo` existiert ebenfalls. Neue
   Lieferanten können sich über den **Registrieren**-Tab selbst anlegen.)

Beim ersten Start werden automatisch **Demodaten** geseedet (3 Rampen, 3
Benutzer, einige Buchungen). Die Daten liegen pro Browser im `localStorage`; ein
„Reset" stellt die Demodaten wieder her.

> **Mehrbenutzerbetrieb gewünscht?** RampSlot bringt zusätzlich einen fertigen,
> abhängigkeitsfreien **Node-Server mit REST-API** mit (`npm start` →
> http://localhost:3000) — siehe [Betriebsarten](#betriebsarten).

---

## Features

### Für Lieferanten
- **Anmeldung & Selbstregistrierung** (neuer Lieferanten-Account).
- **Zeitfenster buchen** (`#/buchen`): Rampe und Tag wählen, freie Slots sehen,
  mit einem Klick buchen.
- Freie/belegte/gesperrte/vergangene Slots sind **farblich klar unterschieden**.
- Buchung mit **Bestell-/Referenznummer** (Pflicht), Menge, Spediteur und Notiz.
- **Meine Buchungen** (`#/meine-buchungen`): eigene Termine einsehen und
  **stornieren**.
- Schutz vor **Doppelbuchung**, ausgebuchten Slots und Buchungen in der
  Vergangenheit.

### Für die Administration
- **Übersicht / Dashboard** (`#/admin`): KPIs des Tages — Buchungen,
  Auslastung, No-Shows, anstehende Termine.
- **Kalender / Tagesboard** (`#/admin/kalender`): alle Rampen und Slots eines
  Tages auf einen Blick.
- **Rampen verwalten** (`#/admin/rampen`): Rampen anlegen/bearbeiten/löschen —
  Öffnungszeiten, Slot-Länge, **Kapazität** (parallele Buchungen je Slot),
  aktiv/inaktiv.
- **Buchungen verwalten** (`#/admin/buchungen`): filtern, Status setzen
  (`bestaetigt` / `erledigt` / `no_show` / `storniert`).
- **Sperrzeiten** je Rampe (Wartung, Pause): blockieren Slots als „gesperrt".
- **Lieferanten** (`#/admin/lieferanten`): Übersicht der registrierten Konten.

---

## Tech-Stack

- **Vanilla JavaScript** (ES5-Stil, IIFE-Module über `window.App`) — **kein
  Framework**, kein Bundler, keine npm-Abhängigkeiten.
- **Persistenz:** Browser-`localStorage`.
- **Routing:** Hash-basiert (`#/...`).
- **Styling:** eine handgeschriebene `assets/styles.css` (Designsystem mit
  Karten, Slots, Tagesboard, Badges, Modals, Toasts).

Läuft direkt per `file://` durch Doppelklick auf `index.html` — deshalb keine
ES-Module, alles hängt am globalen `window.App`.

### Dateistruktur

```
rampenbuchung-app/
  index.html                 Standalone-Shell (localStorage)
  index.server.html          Full-Stack-Shell (Node-Server / REST-API)
  assets/
    styles.css               UI-/UX-Designsystem (alle CSS-Klassen)
  js/
    store.js                 Daten + Domänenlogik (localStorage)   -> window.App.store
    store.api.js             gleiche API, aber REST-gestützt (Full-Stack)
    ui.js                    Komponenten/Helfer       -> window.App.ui (Toast, Modal, …)
    auth.js                  Session / Login (localStorage)         -> window.App.auth
    auth.api.js              Session / Login gegen den Server (Full-Stack)
    supplier.js              Lieferanten-Views        -> window.App.views.supplier
    admin.js                 Admin-Views              -> window.App.views.admin
    app.js                   Bootstrap + Router + Shell (Standalone)
    app.server.js            wie app.js, aber async Boot/Login (Full-Stack)
  server/
    server.js                Zero-Dependency Node-Server (statisch + REST-API)
    API_CONTRACT.md          REST-API-Vertrag
    data.json                Laufzeit-DB (wird erzeugt; .gitignored)
  test/
    integration.test.js      jsdom-Test der Standalone-App        (npm test)
    api.test.js              REST-API-Test (spawnt eigenen Server) (npm run test:api)
    client.test.js           API-Client-Adapter ↔ Server
    fullstack.test.js        integriert: Browser ↔ laufender Server
  backend/
    supabase_schema.sql      Optionales PostgreSQL/Supabase-Schema (Cloud)
    README-backend.md        Anleitung zur Supabase-Anbindung
  CONTRACT.md                Verbindliche Modul-Schnittstellen (Architektur-Vertrag)
  package.json               npm-Skripte (start/test); jsdom nur als devDependency
  README.md                  Dieses Dokument
```

Skript-Ladereihenfolge in `index.html`:
`store → ui → auth → supplier → admin → app`.
Das **Backbone** (`store`, `ui`, `auth`, `app`) stellt die APIs bereit; die
**Views** (`supplier`, `admin`) rendern dagegen. Verbindliche Signaturen siehe
[`CONTRACT.md`](./CONTRACT.md).

**Datenmodell (Kurzfassung, Details in `CONTRACT.md` / `js/store.js`):**
`ramps` (Rampen mit Öffnungszeiten, Slot-Länge, Kapazität) · `bookings`
(Buchungen mit Status `bestaetigt`/`storniert`/`no_show`/`erledigt`) · `blocks`
(Sperrzeiten) · `users` (Lieferant/Admin).

---

## Betriebsarten

### 1. Standalone (Standard) — kein Server
`index.html` doppelklicken. Persistenz pro Browser im `localStorage`. Ideal für
Demo/Einzelplatz, keinerlei Setup.

### 2. Full-Stack mit eigenem Server (enthalten & einsatzbereit)
Echter **Mehrbenutzerbetrieb**: alle teilen sich dieselben Daten, **serverseitige
Authentifizierung** und **serverseitiger Doppelbuchungsschutz**, Persistenz in
`server/data.json`.

```bash
node server/server.js        # oder: npm start
# -> http://localhost:3000   (liefert index.server.html)
```

- **Zero-Dependency:** nur die Node-Standardbibliothek — kein `npm install` nötig.
- **REST-API:** `/api/bootstrap`, `/api/login`, `/api/register`, `/api/ramps`,
  `/api/bookings`, `/api/blocks` (Vertrag: [`server/API_CONTRACT.md`](./server/API_CONTRACT.md)).
- Dieselben Views; nur `store`/`auth` sind durch REST-Adapter (`store.api.js`,
  `auth.api.js`) ersetzt — die Geschäftslogik (inkl. Konfliktprüfung) liegt
  autoritativ im Server.

**Automatisierte Tests** (zusammen 80 Checks):
```bash
npm test                     # Standalone-App in jsdom            (32 Checks)
npm run test:api             # REST-API, startet eigenen Server    (28 Checks)
node test/client.test.js     # API-Client-Adapter ↔ Server         (12 Checks)
node test/fullstack.test.js  # integriert: Browser ↔ Server (Server muss laufen)  (8 Checks)
```

### 3. Cloud-Backend mit Supabase (optional)
Statt des Node-Servers lässt sich RampSlot auch auf **Supabase** (gehostetes
PostgreSQL + Auth + Row Level Security) heben:

- **Schema:** [`backend/supabase_schema.sql`](./backend/supabase_schema.sql) —
  fertiges, kommentiertes Schema (Tabellen `profiles`, `ramps`, `bookings`,
  `blocks`, Doppelbuchungsschutz via Trigger, RLS-Policies, `is_admin()`, Seed).
- **Anleitung:** [`backend/README-backend.md`](./backend/README-backend.md) —
  Projekt anlegen, Schema einspielen, Zugangsdaten holen, App über einen
  store-/auth-Adapter (gleiche `window.App`-API) auf Supabase + Supabase Auth
  umstellen, inkl. Code-Beispielen und Mapping-Tabelle.

---

## Ausblick

Der nächste logische Schritt ist die **Anbindung an Microsoft Dynamics 365
Business Central (BC 365)** sowie der Ausbau Richtung vollwertiges
**Yard-Management** (Self-Check-in, Tor-/Schrankensteuerung, Stellplatz- und
Hofverwaltung, Fahrerkommunikation).

Business Central hat **kein natives Yard-Management** — RampSlot bzw. eine
darauf aufbauende Yard-App füllt genau die Lücke zwischen Werkstor, Hof und
Rampe und kann Buchungen mit BC-Belegen (Einkaufs-/Verkaufsbestellungen)
verknüpfen.

Analyse, Zieldatenmodell, BC-API-Mapping und eine Phasen-Roadmap stehen im
ausführlichen Konzeptdokument:
**[`../docs/yard-management/analyse-und-konzept.md`](../docs/yard-management/analyse-und-konzept.md)**.
