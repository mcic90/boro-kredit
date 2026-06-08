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
  index.html                 Shell; lädt CSS + alle JS in fester Reihenfolge
  assets/
    styles.css               UI-/UX-Designsystem (alle CSS-Klassen)
  js/
    store.js                 Daten + Domänenlogik   -> window.App.store
    ui.js                    Komponenten/Helfer      -> window.App.ui (Toast, Modal, …)
    auth.js                  Session / Login         -> window.App.auth (Demo-Auth)
    supplier.js              Lieferanten-Views       -> window.App.views.supplier
    admin.js                 Admin-Views             -> window.App.views.admin
    app.js                   Bootstrap + Router + Shell
  backend/
    supabase_schema.sql      Optionales PostgreSQL/Supabase-Schema
    README-backend.md        Anleitung zur Backend-Anbindung
  CONTRACT.md                Verbindliche Modul-Schnittstellen (Architektur-Vertrag)
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

## Echtes Backend (optional)

Für den **Mehrbenutzerbetrieb** (Lieferanten und Admin teilen sich dieselben
Daten, echte Authentifizierung, serverseitiger Doppelbuchungsschutz) lässt sich
RampSlot von `localStorage` auf **Supabase** (gehostetes PostgreSQL + Auth + Row
Level Security) umstellen. Das ist optional — die App funktioniert ohne Backend.

- **Schema:** [`backend/supabase_schema.sql`](./backend/supabase_schema.sql) —
  fertiges, kommentiertes Schema (Tabellen `profiles`, `ramps`, `bookings`,
  `blocks`, Doppelbuchungsschutz via UNIQUE-Index + Trigger, RLS-Policies,
  `is_admin()`-Hilfsfunktion, optionaler Seed).
- **Anleitung:** [`backend/README-backend.md`](./backend/README-backend.md) —
  Schritt für Schritt Projekt anlegen, Schema einspielen, Zugangsdaten holen,
  und die App über einen **store-/auth-Adapter** (gleiche `window.App`-API) auf
  Supabase + Supabase Auth umstellen, inkl. Code-Beispielen und einer
  Mapping-Tabelle `store.js`-Funktion → Supabase-Query.

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
