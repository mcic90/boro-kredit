# Full-Stack API-Vertrag — RampSlot Server

Zero-Dependency Node-Backend (`server/server.js`) — serviert die App **und** eine REST-API,
Persistenz in `server/data.json`. Start: `node server/server.js` → http://localhost:3000

## Statisch
- `GET /`            → liefert `index.server.html` (Full-Stack-Build)
- `GET /js/*`, `/assets/*`, `*.html` → Dateien aus dem App-Ordner (`rampenbuchung-app/`)

## REST-API (JSON, Präfix `/api`)
Alle Antworten JSON. Fehler: `{ "ok": false, "error": "…" }` mit passendem Statuscode.

| Methode & Pfad | Body | Antwort |
|---|---|---|
| `GET /api/bootstrap` | – | `{ ramps:[], bookings:[], blocks:[], users:[] }` (users **ohne** Passwort) |
| `POST /api/login` | `{email,password}` | `{ ok:true, user }` \| `{ok:false,error}` (401) |
| `POST /api/register` | `{company,name,email,password}` | `{ ok:true, user }` \| error (409/400) |
| `POST /api/ramps` | ramp-Felder | `{ ok:true, ramp }` |
| `PATCH /api/ramps/:id` | Teilfelder | `{ ok:true, ramp }` |
| `DELETE /api/ramps/:id` | – | `{ ok:true }` (kaskadiert Buchungen/Sperren) |
| `POST /api/bookings` | `{rampId,date,start,supplierId,supplierName,email,carrier,orderRef,qty,notes}` | `{ ok:true, booking }` \| `{ok:false,error}` (409 bei Konflikt) — **serverseitige** Prüfung Vergangenheit/Sperre/Kapazität/orderRef |
| `PATCH /api/bookings/:id` | `{status}` (`bestaetigt\|storniert\|no_show\|erledigt`) | `{ ok:true, booking }` |
| `POST /api/blocks` | `{rampId,date,start,end,reason}` | `{ ok:true, block }` |
| `DELETE /api/blocks/:id` | – | `{ ok:true }` |

## Objekt-Felder (= App-Datenmodell, siehe ../CONTRACT.md)
- ramp: `{ id,name,openFrom,openTo,slotMinutes,capacity,active }`
- booking: `{ id,rampId,date,start,end,supplierId,supplierName,email,carrier,orderRef,qty,notes,status,createdAt }`
- block: `{ id,rampId,date,start,end,reason }`
- user: `{ id,type('lieferant'|'admin'),company,name,email }` (+ `password` nur serverseitig)

## Client-Build (Full-Stack)
`index.server.html` lädt: `js/store.api.js` (statt store.js), `js/ui.js`, `js/auth.api.js` (statt auth.js),
`js/supplier.js`, `js/admin.js`, `js/app.server.js` (statt app.js).
- `store.api.js`: gleiche `window.App.store`-API; Cache wird in `init()` (async) via `GET /api/bootstrap`
  befüllt; Lese-Methoden synchron über Cache (Logik wie store.js); Mutationen = optimistische
  Cache-Änderung + async Write-Through an die API.
- `auth.api.js`: `login`/`register` async gegen `/api/*`; `current()` synchron aus Cache; `logout()` lokal.
- `app.server.js`: wie app.js, aber `start()` wartet auf `App.store.init()` (Promise) und die Login-/
  Register-Handler behandeln `App.auth.*` als Promise.
- `ui.js`, `supplier.js`, `admin.js` bleiben **unverändert** (lesen synchron aus dem Cache).
