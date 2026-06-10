# RampSlot — Echtes Backend mit Supabase (optional)

> Die App läuft **standalone mit `localStorage`** — ohne Server, ohne Build.
> Dieses Dokument beschreibt den **optionalen** Umstieg auf ein echtes,
> mehrbenutzerfähiges Backend mit **Supabase** (gehostetes PostgreSQL + Auth +
> Row Level Security). Das Datenmodell ist 1:1 aus `../js/store.js` abgeleitet
> und liegt fertig in [`supabase_schema.sql`](./supabase_schema.sql).

**Warum überhaupt ein Backend?** `localStorage` ist pro Browser/Gerät isoliert:
Buchungen eines Lieferanten sind für den Admin nicht sichtbar, es gibt keine
echte Authentifizierung und keinen serverseitigen Doppelbuchungsschutz. Supabase
löst genau das — bei minimalem Aufwand, weil die App-API (`window.App.store`)
gleich bleibt und nur der **Datenadapter** ausgetauscht wird.

---

## Inhalt
1. [Supabase-Projekt anlegen](#1-supabase-projekt-anlegen)
2. [Schema einspielen](#2-schema-einspielen)
3. [Zugangsdaten holen (URL + anon key)](#3-zugangsdaten-holen-url--anon-key)
4. [Benutzer & Profile anlegen](#4-benutzer--profile-anlegen)
5. [App von localStorage auf Supabase umstellen](#5-app-von-localstorage-auf-supabase-umstellen)
6. [Auth: App.auth → Supabase Auth](#6-auth-appauth--supabase-auth)
7. [Beispiel-Implementierungen (store-Adapter)](#7-beispiel-implementierungen-store-adapter)
8. [Mapping-Tabelle: store.js → Supabase-Query](#8-mapping-tabelle-storejs--supabase-query)
9. [RLS-Hinweise & Stolperfallen](#9-rls-hinweise--stolperfallen)

---

## 1. Supabase-Projekt anlegen

1. Konto erstellen / einloggen unter <https://supabase.com> (kostenloser Tarif
   genügt für Demo/PoC).
2. **New project** wählen:
   - **Organization** auswählen oder neu anlegen.
   - **Name**, z. B. `rampslot`.
   - **Database Password** vergeben (gut wegspeichern — wird für direkte
     DB-Zugriffe gebraucht, nicht für die App).
   - **Region** möglichst nah an den Nutzern (z. B. *Frankfurt (eu-central-1)*).
3. **Create new project** — die Provisionierung dauert ca. 1–2 Minuten.

---

## 2. Schema einspielen

1. Im Projekt links **SQL Editor** öffnen → **New query**.
2. Den **gesamten** Inhalt von [`supabase_schema.sql`](./supabase_schema.sql)
   einfügen und **Run** klicken.
3. Das Skript legt an:
   - Tabellen `profiles`, `ramps`, `bookings`, `blocks` (Schema `public`),
   - Doppelbuchungsschutz (kapazitätsbewusster `BEFORE INSERT/UPDATE`-Trigger;
     unterstützt auch `capacity > 1`),
   - Hilfsfunktion `is_admin()` (SECURITY DEFINER),
   - **Row Level Security + Policies** für alle vier Tabellen.
4. Erfolg prüfen: links **Table Editor** → die vier Tabellen müssen sichtbar
   sein. Unter **Database → Policies** stehen die RLS-Policies.

> **Demo-Rampen seeden:** Im Schema ist unter Abschnitt *9) OPTIONAL: Seed* ein
> `INSERT`-Block für die drei Demo-Rampen auskommentiert. Zum Befüllen einfach
> einkommentieren und erneut ausführen (oder separat im SQL-Editor laufen
> lassen). Buchungen/Profile werden **nicht** geseedet, weil Profile an echte
> `auth.users` hängen müssen — siehe Schritt 4.

---

## 3. Zugangsdaten holen (URL + anon key)

Links **Project Settings → API** (bzw. **Settings → API Keys**):

| Wert | Wo | Wofür |
|---|---|---|
| **Project URL** | `https://<projekt-ref>.supabase.co` | Basis-URL für den Client |
| **anon / public (publishable) key** | langer JWT/`sb_publishable_...` | clientseitiger Schlüssel für die Browser-App |
| **service_role key** | unter „Project API keys" | **NUR serverseitig!** Umgeht RLS — niemals ins Frontend |

> **Sicherheit:** Der **anon/publishable key** ist für den Browser gedacht und
> darf öffentlich sein — er gewährt **keinen** Zugriff über die RLS-Policies
> hinaus. Der **service_role key** umgeht RLS komplett und gehört **niemals** in
> Client-Code oder ins Git-Repo.

---

## 4. Benutzer & Profile anlegen

Passwörter verwaltet **Supabase Auth**, nicht die `profiles`-Tabelle (sie hat
bewusst **kein** Passwort-Feld — anders als `state.users` in `store.js`).

1. Links **Authentication → Users → Add user** → E-Mail + Passwort vergeben
   (z. B. `admin@demo.de` / ein sicheres Passwort).
2. Für jeden Auth-Benutzer ein Profil-Zeile in `public.profiles` anlegen. Zwei
   Wege:
   - **Automatisch:** Im Schema unter Abschnitt *8) OPTIONAL* den Trigger
     `handle_new_user()` einkommentieren — dann entsteht bei jeder Registrierung
     automatisch ein `lieferant`-Profil aus den `signUp`-Metadaten.
   - **Manuell** (SQL-Editor), `id` = die `auth.users.id` des Nutzers:
     ```sql
     insert into public.profiles (id, type, company, name, email)
     values ('<auth-user-uuid>', 'lieferant', 'Müller Spedition GmbH',
             'Max Müller', 'lieferant@demo.de');
     ```
3. **Admin hochstufen** (Beispiel steht auch im Schema):
   ```sql
   update public.profiles
     set type = 'admin', company = 'Werk Karlsruhe', name = 'Hof-Administration'
     where email = 'admin@demo.de';
   ```

Damit ist `profiles.type` (`lieferant` | `admin`) die **einzige Rollenquelle** —
sie steuert sowohl die App-Navigation als auch die RLS-Policies via `is_admin()`.

---

## 5. App von localStorage auf Supabase umstellen

**Leitidee:** Die gesamte App spricht nur mit `window.App.store` und
`window.App.auth` (siehe `../CONTRACT.md`). Es muss also **kein View-Code**
angefasst werden — es reicht, diese beiden Backbone-Module durch
Supabase-Adapter mit **identischer Signatur** zu ersetzen.

Ein Haken: Die heutige `store`-API ist **synchron** (gibt direkt Werte zurück),
Supabase-Aufrufe sind **asynchron** (`await`). Für die saubere Umstellung gibt es
zwei Strategien:

- **A — empfohlen:** `store`-Adaptermethoden geben `Promise` zurück und die Views
  rufen sie mit `await` auf. Das erfordert kleine Anpassungen in den Views
  (`render` wird `async`), ist aber das ehrliche Modell für ein Netzwerk-Backend.
- **B — minimal-invasiv:** Beim App-Start einmal alle Rampen/Buchungen/Blocks/
  Profile in einen **In-Memory-Cache** laden (`await loadAll()`), die bisherigen
  **synchronen** Lesefunktionen (`listRamps`, `getDaySlots`, `kpisForDate`…) aus
  diesem Cache bedienen und nur **Schreib**operationen (`createBooking`,
  `setBookingStatus`, …) asynchron gegen Supabase fahren + danach den Cache
  aktualisieren. So bleiben die Views fast unverändert. Optional via
  **Realtime-Subscriptions** den Cache live nachführen.

Einbindung des Clients (CDN, **ESM** — keine Build-Tools nötig). In `index.html`
**vor** den App-Skripten z. B.:

```html
<!-- Supabase-Client (CDN, ES-Modul) -->
<script type="module">
  import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
  window.supabaseClient = createClient(
    "https://<projekt-ref>.supabase.co", // Project URL aus Schritt 3
    "<ANON_PUBLISHABLE_KEY>"             // anon/publishable key aus Schritt 3
  );
</script>

<!-- Adapter STATT js/store.js + js/auth.js laden -->
<script src="js/store.supabase.js"></script>
<script src="js/auth.supabase.js"></script>
<!-- danach wie gehabt: -->
<script src="js/ui.js"></script>
<script src="js/supplier.js"></script>
<script src="js/admin.js"></script>
<script src="js/app.js"></script>
```

> Tipp: Den Original-`store.js` **nicht** löschen — durch simples Umschalten der
> `<script>`-Zeilen kann man jederzeit zwischen Demo (localStorage) und Backend
> (Supabase) wechseln.

---

## 6. Auth: App.auth → Supabase Auth

Das Demo-`auth.js` (Klartext-Passwörter im `localStorage`) wird durch **Supabase
Auth** ersetzt — gleiche `window.App.auth`-API, aber echte Sessions/JWTs:

```js
/* js/auth.supabase.js — ersetzt js/auth.js (gleiche API: current/login/register/logout) */
(function () {
  "use strict";
  window.App = window.App || {};
  var sb = function () { return window.supabaseClient; };
  var _user = null; // gecachtes Profil (aus public.profiles)

  async function loadProfile(authUser) {
    if (!authUser) return null;
    var res = await sb().from("profiles").select("*").eq("id", authUser.id).single();
    if (res.error || !res.data) return null;
    // Profil -> App-User-Form mappen (type/company/name/email/id)
    return { id: res.data.id, type: res.data.type, company: res.data.company,
             name: res.data.name, email: res.data.email };
  }

  function current() { return _user; } // synchron; nach init()/login() befüllt

  async function login(email, password) {
    var res = await sb().auth.signInWithPassword({ email: email, password: password });
    if (res.error) return { ok: false, error: res.error.message };
    _user = await loadProfile(res.data.user);
    return { ok: true, user: _user };
  }

  async function register(data) {
    if (!data.company || !data.email || !data.password)
      return { ok: false, error: "Firma, E-Mail und Passwort sind erforderlich." };
    // company/name als user_metadata -> handle_new_user()-Trigger legt Profil an
    var res = await sb().auth.signUp({
      email: data.email, password: data.password,
      options: { data: { company: data.company, name: data.name || "" } }
    });
    if (res.error) return { ok: false, error: res.error.message };
    _user = await loadProfile(res.data.user);
    return { ok: true, user: _user };
  }

  async function logout() { await sb().auth.signOut(); _user = null; }

  // Beim App-Start bestehende Session wiederherstellen:
  async function init() {
    var res = await sb().auth.getUser();
    _user = await loadProfile(res.data && res.data.user);
    return _user;
  }

  window.App.auth = { current: current, login: login, register: register, logout: logout, init: init };
})();
```

**Wichtig:**
- `register()` legt einen **Lieferanten** an — Admins werden nachträglich per SQL
  hochgestuft (Schritt 4), genau wie in der Demo nur Lieferanten registrierbar
  sind.
- `current()` bleibt synchron, indem das Profil nach `login()`/`init()` gecacht
  wird; `app.js` muss beim Bootstrap einmal `await App.auth.init()` aufrufen,
  bevor es routet.
- Die **Rolle** kommt aus `profiles.type` — nicht aus der Auth-Schicht.

---

## 7. Beispiel-Implementierungen (store-Adapter)

Auszug aus `js/store.supabase.js` — exemplarisch `init`, `listRamps`,
`getDaySlots` (Daten laden) und `createBooking`. Die Methoden geben `Promise`
zurück (Strategie A); Rückgabeformen entsprechen `CONTRACT.md`. Beachte das
**Feld-Mapping** snake_case (DB) ↔ camelCase (App).

```js
/* js/store.supabase.js — Supabase-Adapter, gleiche API wie window.App.store */
(function () {
  "use strict";
  window.App = window.App || {};
  var sb = function () { return window.supabaseClient; };

  // --- Zeit-Helfer (identisch zur localStorage-Variante) ---
  function pad(n){ return String(n).padStart(2,"0"); }
  function toMin(hm){ var p=String(hm).split(":"); return (+p[0])*60+(+p[1]); }
  function toHM(m){ return pad(Math.floor(m/60))+":"+pad(m%60); }
  function today(){ var d=new Date(); return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
  function nowHM(){ var d=new Date(); return pad(d.getHours())+":"+pad(d.getMinutes()); }

  // DB-Zeit 'HH:MM:SS' -> App 'HH:MM'
  function hm(t){ return t ? String(t).slice(0,5) : t; }

  // DB-Row -> App-ramp
  function mapRamp(r){
    return { id:r.id, name:r.name, openFrom:hm(r.open_from), openTo:hm(r.open_to),
             slotMinutes:r.slot_minutes, capacity:r.capacity, active:r.active };
  }
  // DB-Row -> App-booking
  function mapBooking(b){
    return { id:b.id, rampId:b.ramp_id, date:b.booking_date, start:hm(b.start_time),
             end:hm(b.end_time), supplierId:b.supplier_id, supplierName:b.supplier_name,
             email:b.email, carrier:b.carrier, orderRef:b.order_ref, qty:b.qty,
             notes:b.notes, status:b.status, createdAt:b.created_at };
  }
  // DB-Row -> App-block
  function mapBlock(bl){
    return { id:bl.id, rampId:bl.ramp_id, date:bl.block_date, start:hm(bl.start_time),
             end:hm(bl.end_time), reason:bl.reason };
  }

  // --- init: Verbindung prüfen (statt localStorage laden) ---
  async function init(){
    // RLS sorgt dafür, dass nur erlaubte Zeilen kommen; ein leichter Ping genügt.
    var res = await sb().from("ramps").select("id").limit(1);
    if (res.error) throw new Error("Supabase-Verbindung fehlgeschlagen: " + res.error.message);
    return true;
  }

  // --- listRamps(activeOnly) -> [ramp] ---
  async function listRamps(activeOnly){
    var q = sb().from("ramps").select("*").order("name", { ascending:true });
    if (activeOnly) q = q.eq("active", true);
    var res = await q;
    if (res.error) throw res.error;
    return res.data.map(mapRamp);
  }

  // --- getDaySlots(rampId, date): Slots clientseitig aus Rampe+Buchungen+Blocks bauen ---
  //     Spiegelt rawSlots()+activeBookingsAt()+blockAt()+isPast() aus store.js.
  async function getDaySlots(rampId, date){
    var rampRes = await sb().from("ramps").select("*").eq("id", rampId).single();
    if (rampRes.error || !rampRes.data) return [];
    var ramp = mapRamp(rampRes.data);

    // Nur AKTIVE Buchungen belegen Kapazität (wie activeBookingsAt()):
    var bRes = await sb().from("bookings").select("*")
      .eq("ramp_id", rampId).eq("booking_date", date)
      .in("status", ["bestaetigt","erledigt"]);
    if (bRes.error) throw bRes.error;
    var bookings = bRes.data.map(mapBooking);

    var blRes = await sb().from("blocks").select("*")
      .eq("ramp_id", rampId).eq("block_date", date);
    if (blRes.error) throw blRes.error;
    var blocks = blRes.data.map(mapBlock);

    function isPast(d,end){ var t=today();
      return d<t || (d===t && toMin(end)<=toMin(nowHM())); }

    var out=[], cur=toMin(ramp.openFrom), end=toMin(ramp.openTo);
    while (cur + ramp.slotMinutes <= end){
      var s={ start:toHM(cur), end:toHM(cur+ramp.slotMinutes) };
      var bks = bookings.filter(function(b){ return b.start===s.start; });
      var block = blocks.find(function(bl){
        return toMin(bl.start)<=toMin(s.start) && toMin(bl.end)>=toMin(s.end); }) || null;
      var status = isPast(date, s.end) ? "vergangen"
                 : block ? "gesperrt"
                 : (bks.length >= ramp.capacity) ? "belegt" : "frei";
      out.push({ start:s.start, end:s.end, status:status,
                 booked:bks.length, capacity:ramp.capacity, bookings:bks, block:block });
      cur += ramp.slotMinutes;
    }
    return out;
  }

  // --- createBooking(data) -> { ok, booking?, error? } ---
  //     Validierung wie store.js; den FINALEN Kapazitätsschutz erzwingt die DB
  //     (Trigger enforce_booking_capacity) — dessen Fehler fangen wir ab und melden ihn schön.
  async function createBooking(data){
    var rampRes = await sb().from("ramps").select("*").eq("id", data.rampId).single();
    if (rampRes.error || !rampRes.data) return { ok:false, error:"Rampe nicht gefunden." };
    var ramp = mapRamp(rampRes.data);
    if (!data.date || !data.start) return { ok:false, error:"Datum und Zeitfenster erforderlich." };
    if (!data.orderRef) return { ok:false, error:"Bitte eine Bestell-/Referenznummer angeben." };

    var end = toHM(toMin(data.start) + ramp.slotMinutes);
    var t = today();
    if (data.date < t || (data.date===t && toMin(end)<=toMin(nowHM())))
      return { ok:false, error:"Dieses Zeitfenster liegt in der Vergangenheit." };

    var insert = {
      ramp_id:data.rampId, booking_date:data.date, start_time:data.start, end_time:end,
      supplier_id:data.supplierId || null, supplier_name:data.supplierName || "",
      email:data.email || "", carrier:data.carrier || data.supplierName || "",
      order_ref:data.orderRef, qty:(+data.qty || 0), notes:data.notes || "",
      status:"bestaetigt"
    };
    var res = await sb().from("bookings").insert(insert).select().single();
    if (res.error){
      // 23514 = check_violation (so wirft unser Trigger enforce_booking_capacity);
      // zur Sicherheit zusätzlich auf die Meldung matchen.
      if (res.error.code === "23514" || /ausgebucht|gesperrt|Kapazitaet/i.test(res.error.message))
        return { ok:false, error:"Dieses Zeitfenster ist bereits ausgebucht oder gesperrt." };
      return { ok:false, error:res.error.message };
    }
    return { ok:true, booking:mapBooking(res.data) };
  }

  // ... weitere Methoden analog (siehe Mapping-Tabelle unten) ...

  window.App.store = {
    init:init, today:today, nowHM:nowHM,
    listRamps:listRamps, getDaySlots:getDaySlots, createBooking:createBooking
    // getRamp, createRamp, updateRamp, deleteRamp, listBookings,
    // listBookingsBySupplier, getBooking, cancelBooking, setBookingStatus,
    // addBlock, removeBlock, listUsers, getUser, getUserByEmail, createUser,
    // kpisForDate  -> nach gleichem Muster ergänzen
  };
})();
```

---

## 8. Mapping-Tabelle: store.js → Supabase-Query

> `sb` = `window.supabaseClient`. Alle Lese-Queries werden zusätzlich durch
> **RLS** gefiltert (Lieferant sieht nur Eigenes, Admin alles).

| `store.js`-Funktion | Supabase-Query (Kern) | Hinweis |
|---|---|---|
| `init()` | `sb.from('ramps').select('id').limit(1)` | Verbindungs-Ping statt localStorage |
| `reset()` | — | entfällt (kein Seed im Client; siehe Schema-Seed) |
| `today()` / `nowHM()` | — | lokal, unverändert übernommen |
| `listRamps(activeOnly)` | `sb.from('ramps').select('*')` `[.eq('active',true)]` | `mapRamp` |
| `getRamp(id)` | `sb.from('ramps').select('*').eq('id',id).single()` | |
| `createRamp(data)` | `sb.from('ramps').insert({...}).select().single()` | nur Admin (RLS) |
| `updateRamp(id,data)` | `sb.from('ramps').update({...}).eq('id',id).select().single()` | nur Admin |
| `deleteRamp(id)` | `sb.from('ramps').delete().eq('id',id)` | `bookings`/`blocks` via `on delete cascade` |
| `getDaySlots(rampId,date)` | Rampe + `bookings`(`in status`) + `blocks` laden, Slots clientseitig bauen | spiegelt `rawSlots/activeBookingsAt/blockAt/isPast` |
| `createBooking(data)` | `sb.from('bookings').insert({...}).select().single()` | DB-Trigger/UNIQUE = finaler Schutz |
| `listBookings(filter)` | `sb.from('bookings').select('*')` `+ .eq(...)` je Filter `+ .order('booking_date').order('start_time')` | `date→booking_date`, `start→start_time` |
| `listBookingsBySupplier(id)` | `sb.from('bookings').select('*').eq('supplier_id',id)` | = `listBookings({supplierId})` |
| `getBooking(id)` | `sb.from('bookings').select('*').eq('id',id).single()` | |
| `cancelBooking(id)` | `sb.from('bookings').update({status:'storniert'}).eq('id',id)` | |
| `setBookingStatus(id,s)` | `sb.from('bookings').update({status:s}).eq('id',id)` | |
| `addBlock(rampId,date,start,end,reason)` | `sb.from('blocks').insert({ramp_id,block_date,start_time,end_time,reason}).select().single()` | nur Admin |
| `removeBlock(id)` | `sb.from('blocks').delete().eq('id',id)` | nur Admin |
| `listUsers(type)` | `sb.from('profiles').select('*')` `[.eq('type',type)]` | nur Admin sieht alle (RLS) |
| `getUser(id)` | `sb.from('profiles').select('*').eq('id',id).single()` | |
| `getUserByEmail(email)` | `sb.from('profiles').select('*').ilike('email',email).maybeSingle()` | |
| `createUser(data)` | `sb.auth.signUp(...)` **+** `profiles`-Insert/Trigger | Auth-Layer, nicht reiner Tabellen-Insert |
| `kpisForDate(date)` | `listRamps(true)` + `listBookings({date})`, dann clientseitig rechnen | identische Formel wie `store.js` |

---

## 9. RLS-Hinweise & Stolperfallen

- **Ohne Login kein Zugriff.** Policies gelten für die Rolle `authenticated`. Die
  `anon`-Rolle erhält bewusst keine Policy → die App **muss** eingeloggt sein,
  bevor sie Daten lädt (`await App.auth.init()` im Bootstrap).
- **Rolle = `profiles.type`.** Die Admin-Prüfung läuft serverseitig über
  `is_admin()` (SECURITY DEFINER, fixer `search_path`) — nicht manipulierbar vom
  Client. Schreibrechte auf `ramps`/`blocks` und Fremd-Buchungen hat nur, wer in
  `profiles` `type='admin'` hat.
- **Lieferant = eigene Daten.** `bookings`-Policies erlauben SELECT/INSERT/UPDATE
  nur für `supplier_id = auth.uid()`. Beim Anlegen **muss** der Client
  `supplier_id` auf die eigene `auth.uid()` setzen, sonst greift die
  `with check`-Klausel.
- **Doppelbuchungsschutz ist serverseitig.** Selbst bei gleichzeitigen Klicks
  zweier Lieferanten verhindert der **Trigger** `enforce_booking_capacity` die
  Überbuchung — kapazitätsbewusst, also auch für `capacity > 1` korrekt. Der
  Client sollte den DB-Fehler (`check_violation`, SQLSTATE `23514`) abfangen und
  als „bereits ausgebucht" melden — siehe `createBooking` oben. (Wer nur
  `capacity = 1` fährt, kann alternativ den im Schema dokumentierten partiellen
  UNIQUE-Index nutzen; beides nicht kombinieren.)
- **Snapshot-Felder.** `supplier_name`/`email`/`carrier` werden — wie in
  `store.js` — als Kopie in der Buchung gehalten, damit historische Buchungen
  stabil bleiben, auch wenn sich das Profil ändert.
- **service_role nie ins Frontend.** Nur den **anon/publishable key** verwenden.
- **Realtime (optional):** Für eine Live-Kalenderansicht kann man
  `sb.channel(...).on('postgres_changes', ...)` auf `bookings`/`blocks`
  abonnieren und `refresh()` der aktuellen View triggern.

---

Siehe auch das Schema mit allen Kommentaren: [`supabase_schema.sql`](./supabase_schema.sql).
