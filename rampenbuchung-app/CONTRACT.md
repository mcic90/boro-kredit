# Architektur-Vertrag — Rampenbuchung-App

> Verbindliche Schnittstellen für alle Module. Jeder Agent baut **nur** gegen diese
> Signaturen und Klassennamen. Keine ES-Module (läuft per `file://` durch Doppelklick) —
> alles hängt am globalen `window.App`. Sprache der UI: **Deutsch**.

## Dateistruktur
```
rampenbuchung-app/
  index.html               (Shell, lädt CSS + alle JS in fester Reihenfolge)
  assets/styles.css        (Agent: UI/UX-Designsystem)
  js/store.js              (Backbone: Daten + Domänenlogik)   -> window.App.store
  js/ui.js                 (Backbone: Komponenten/Helfer)     -> window.App.ui
  js/auth.js               (Backbone: Session/Login)          -> window.App.auth
  js/supplier.js           (Agent: Lieferanten-Views)         -> window.App.views.supplier
  js/admin.js              (Agent: Admin-Views)               -> window.App.views.admin
  js/app.js                (Backbone: Bootstrap + Router + Shell)
  backend/supabase_schema.sql   (Agent: echtes Backend, optional zuschaltbar)
  backend/README-backend.md     (Agent: Anbindung)
  README.md                (Agent: Gesamtdoku)
```
Script-Reihenfolge in index.html: `store → ui → auth → supplier → admin → app`.

## Datenmodell (state)
```js
state = {
  ramps:    [{ id, name, openFrom:'HH:MM', openTo:'HH:MM', slotMinutes:Number, capacity:Number, active:Boolean }],
  bookings: [{ id, rampId, date:'YYYY-MM-DD', start:'HH:MM', end:'HH:MM',
               supplierId, supplierName, email, carrier, orderRef, qty, notes,
               status:'bestaetigt'|'storniert'|'no_show'|'erledigt', createdAt }],
  blocks:   [{ id, rampId, date:'YYYY-MM-DD', start:'HH:MM', end:'HH:MM', reason }],
  users:    [{ id, type:'lieferant'|'admin', company, name, email, password, createdAt }],
  session:  { userId } | null
}
```

## window.App.store  (Backbone schreibt — Agenten nutzen)
```
init()                              // lädt aus localStorage oder seedet Demodaten
reset()                            // löscht + seedet neu
today()                            // -> 'YYYY-MM-DD' (lokal)
nowHM()                            // -> 'HH:MM' (lokal)

// Rampen
listRamps(activeOnly=false)        // -> [ramp]
getRamp(id)                        // -> ramp|undefined
createRamp(data)                   // -> ramp
updateRamp(id, data)               // -> ramp
deleteRamp(id)                     // -> boolean

// Slots
getDaySlots(rampId, date)          // -> [{ start,end, status:'frei'|'belegt'|'gesperrt'|'vergangen',
                                   //        booked:Number, capacity:Number, bookings:[booking], block }]
// Buchungen
createBooking(data)                // -> { ok:Boolean, booking?, error? }  (prüft Konflikt/Kapazität/Vergangenheit)
listBookings(filter={})            // filter: {date, rampId, status, supplierId} -> [booking] (sortiert)
listBookingsBySupplier(supplierId) // -> [booking]
getBooking(id)                     // -> booking|undefined
cancelBooking(id)                  // -> boolean
setBookingStatus(id, status)       // -> boolean

// Sperren
addBlock(rampId, date, start, end, reason) // -> block
removeBlock(id)                    // -> boolean

// Benutzer
listUsers(type)                    // type optional -> [user]
getUser(id) / getUserByEmail(email)
createUser(data)                   // -> user

// KPIs
kpisForDate(date)                  // -> { bookings, capacity, utilization(0..1), noShows, upcoming }
```

## window.App.auth  (Backbone)
```
current()                          // -> user|null
login(email, password)             // -> { ok, user?, error? }
register({company,name,email,password}) // -> { ok, user? , error? }  (legt 'lieferant' an)
logout()
```

## window.App.ui  (Backbone — Agenten nutzen diese Komponenten)
```
toast(message, type='info'|'success'|'error', ms=3200)
modal({ title, body /*html-string*/, actions:[{label, kind:'primary'|'ghost'|'danger', onClick(close)}], onClose }) // -> {close}
confirm(message, {okLabel='OK', danger=false}) // -> Promise<boolean>
escapeHtml(s) / fmtDate(iso) /*'08.06.2026'*/ / fmtDateLong(iso) /*'Mo, 08.06.2026'*/
statusBadge(status) // -> html-string (<span class="badge badge--…">…</span>)
```

## Views  (Agenten schreiben)
```
window.App.views.supplier.render(route, root, ctx)
window.App.views.admin.render(route, root, ctx)
```
- `route`: Sub-Pfad (siehe Routen). `root`: DOM-Container (`<main class="view">`), wird per innerHTML befüllt.
- `ctx = { user, store:App.store, ui:App.ui, navigate(hash), refresh() }`
- Views verdrahten ihre Events selbst (addEventListener nach dem Setzen von innerHTML, oder Delegation auf `root`).

## Routen (Hash-basiert; app.js rendert Shell + ruft Views)
- `#/login` (app.js)
- Lieferant: `#/buchen` (route='buchen'), `#/meine-buchungen` (route='meine')
- Admin: `#/admin` (route='uebersicht'), `#/admin/kalender` (route='kalender'),
  `#/admin/rampen` (route='rampen'), `#/admin/buchungen` (route='buchungen'),
  `#/admin/lieferanten` (route='lieferanten')

## CSS-Klassen (CSS-Agent stylt genau diese; View-Agenten nutzen NUR diese)
Layout: `.app-shell .topbar .brand .brand-mark .topbar-actions .user-chip .sidebar .nav .nav-link (.is-active) .main .view`
Buttons: `.btn .btn--primary .btn--ghost .btn--danger .btn--sm .btn--block`
Cards/Grid: `.card .card__title .card__sub .card__body .grid .grid--2 .grid--3 .toolbar .spacer`
Forms: `.field .label .input .select .textarea .form-row .help .checkbox`
Slots: `.slot-list .slot .slot--frei .slot--belegt .slot--gesperrt .slot--vergangen .slot__time .slot__meta`
Board: `.board .board__col .board__colhead .board__cells .board__cell (.is-frei .is-belegt .is-gesperrt .is-vergangen)`
Tabelle: `.table .badge .badge--bestaetigt .badge--storniert .badge--no_show .badge--erledigt .badge--gesperrt`
KPI: `.kpi-grid .kpi .kpi__value .kpi__label`
Feedback: `.toast .toast--success .toast--error .toast--info .modal-backdrop .modal .modal__head .modal__body .modal__foot`
Hilfen: `.empty .muted .tag .date-nav .pill`
Login/Shell: `.app-body .auth-wrap .auth-card .auth-tabs (button.is-active) .auth-demo .modal__close .error-box #toast-host`
Designrichtung: modern, sauber, Logistik/Industrie, klare Hierarchie, responsive, gut lesbar, Akzentfarbe blau/indigo, Statusfarben grün(frei)/rot(belegt)/grau(gesperrt).
