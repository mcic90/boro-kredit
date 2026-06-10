/* Integrationstest mit jsdom – lädt das echte index.html + alle Skripte und klickt die App durch.
   Ausführen aus dem App-Ordner:  npm install  &&  npm test
   (jsdom ist nur eine devDependency; die App selbst läuft ohne Abhängigkeiten.) */
const { JSDOM } = require("jsdom");
const fs = require("fs");

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log("PASS " + m); } else { fail++; console.log("FAIL " + m); } }
function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

const html = fs.readFileSync("index.html", "utf8");
const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/", pretendToBeVisual: true });
const { window } = dom;
const doc = window.document;
window.requestAnimationFrame = function (cb) { return setTimeout(cb, 0); };
window.cancelAnimationFrame = function () {};
try { window.localStorage.clear(); } catch (e) {}

function fire(el, type) { el.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true })); }
function go(hash) { window.location.hash = hash; fire(window, "hashchange"); }
function q(sel, root) { return (root || doc).querySelector(sel); }

try {
  ["js/store.js", "js/ui.js", "js/auth.js", "js/supplier.js", "js/admin.js", "js/app.js"]
    .forEach(function (f) { window.eval(fs.readFileSync(f, "utf8")); });

  // app.js bootstrappt per DOMContentLoaded; in jsdom ggf. noch nicht gefeuert -> sicher auslösen
  if (!q("#form-login") && !q(".app-shell")) fire(doc, "DOMContentLoaded");

  ok(window.App && window.App.store, "App.store geladen");
  ok(window.App.ui && window.App.auth, "App.ui + App.auth geladen");
  ok(window.App.views && window.App.views.supplier && window.App.views.admin, "Views registriert (supplier+admin)");
  ok(q("#form-login"), "Login-Ansicht wird gerendert");

  // ---- ADMIN ----
  q("#form-login input[name=email]").value = "admin@demo.de";
  q("#form-login input[name=password]").value = "demo";
  fire(q("#form-login"), "submit");
  ok(q(".app-shell"), "App-Shell nach Admin-Login");
  ok(window.location.hash === "#/admin", "Standardroute Admin = #/admin");
  ok(q(".kpi"), "Admin-Übersicht zeigt KPI-Karten");

  go("#/admin/kalender");
  ok(q(".board"), "Admin-Kalender zeigt .board");
  ok(q(".board__col"), "Kalender hat Rampen-Spalten");

  go("#/admin/rampen");
  ok(doc.body.textContent.indexOf("Rampe 1") > -1, "Rampen-Ansicht listet Seed-Rampe");

  go("#/admin/buchungen");
  ok(q(".table") || doc.body.textContent.indexOf("Buchung") > -1, "Buchungen-Ansicht rendert");

  go("#/admin/lieferanten");
  ok(doc.body.textContent.indexOf("Spedition") > -1 || q(".table"), "Lieferanten-Ansicht rendert");

  // ---- ADMIN: Rampe über die UI anlegen ----
  go("#/admin/rampen");
  var rampsBefore = window.App.store.listRamps().length;
  var newBtn = q('[data-action="new"]');
  ok(newBtn, "Button 'Neue Rampe' vorhanden");
  if (newBtn) {
    newBtn.click();
    var rm = q(".modal-backdrop");
    ok(rm, "Rampen-Formular-Modal öffnet");
    if (rm) {
      q("#rf-name", rm).value = "Rampe TEST";
      q("#rf-from", rm).value = "06:00";
      q("#rf-to", rm).value = "10:00";
      q("#rf-slot", rm).value = "30";
      q("#rf-cap", rm).value = "1";
      var actChk = q("#rf-active", rm); if (actChk) actChk.checked = true;
      var saved = false;
      rm.querySelectorAll("[data-act]").forEach(function (b) { if (/speich/i.test(b.textContent)) { b.click(); saved = true; } });
      ok(saved, "Speichern im Rampen-Formular geklickt");
    }
  }
  ok(window.App.store.listRamps().length === rampsBefore + 1, "neue Rampe angelegt (Anzahl +1)");
  ok(doc.body.textContent.indexOf("Rampe TEST") > -1, "neue Rampe erscheint in der Liste");

  // ---- ADMIN: freien Slot über den Kalender sperren ----
  go("#/admin/kalender");
  var di2 = q('[data-cal="date"]');
  ok(di2, "Kalender-Datumsauswahl vorhanden");
  if (di2) { di2.value = iso(new Date(Date.now() + 86400000)); fire(di2, "change"); }
  var blocksBefore = window.App.store.getState().blocks.length;
  var freeCell = q(".board__cell.is-frei");
  ok(freeCell, "freie Kalenderzelle (morgen) vorhanden");
  if (freeCell) {
    freeCell.click();
    var bm = q(".modal-backdrop");
    ok(bm, "Sperr-Modal öffnet bei Klick auf freie Zelle");
    if (bm) {
      var br = q("#block-reason", bm); if (br) br.value = "Wartung";
      var blocked = false;
      bm.querySelectorAll("[data-act]").forEach(function (b) { if (/sperr/i.test(b.textContent)) { b.click(); blocked = true; } });
      ok(blocked, "'Slot sperren' geklickt");
    }
  }
  ok(window.App.store.getState().blocks.length === blocksBefore + 1, "Slot wurde gesperrt (blocks +1)");

  q("#btn-logout").click();
  ok(q("#form-login"), "Logout führt zurück zum Login");

  // ---- LIEFERANT ----
  q("#form-login input[name=email]").value = "lieferant@demo.de";
  q("#form-login input[name=password]").value = "demo";
  fire(q("#form-login"), "submit");
  ok(window.location.hash === "#/buchen", "Standardroute Lieferant = #/buchen");
  ok(q(".slot-list") || q(".slot"), "Buchen-Ansicht rendert Slot-Liste");

  // Datum auf morgen setzen (garantiert freie, zukünftige Slots unabhängig von der Uhrzeit)
  var tomorrow = new Date(Date.now() + 86400000);
  var di = q('input[type=date]');
  ok(di, "Datumsauswahl vorhanden");
  if (di) { di.value = iso(tomorrow); fire(di, "change"); }

  var supId = window.App.auth.current().id;
  var before = window.App.store.listBookingsBySupplier(supId).length;

  var free = q(".slot--frei");
  ok(free, "freier Slot vorhanden");
  if (free) {
    free.click();
    var modal = q(".modal-backdrop");
    ok(modal, "Buchungs-Modal öffnet bei Klick auf freien Slot");
    if (modal) {
      var oi = q("input[name=orderRef]", modal) || q('input[type=text]', modal) || q("input", modal);
      if (oi) oi.value = "TEST-9001";
      var clicked = false;
      modal.querySelectorAll("[data-act]").forEach(function (b) {
        if (/buch/i.test(b.textContent)) { b.click(); clicked = true; }
      });
      ok(clicked, "Bestätigen-Button im Modal geklickt");
    }
  }
  var after = window.App.store.listBookingsBySupplier(supId).length;
  ok(after === before + 1, "Buchung über die UI angelegt (Anzahl +1: " + before + "->" + after + ")");

  go("#/meine-buchungen");
  ok(doc.body.textContent.indexOf("TEST-9001") > -1, "neue Buchung erscheint in 'Meine Buchungen'");

  // ---- Konfliktschutz: gleicher Slot erneut darf NICHT gehen ----
  var dupBefore = window.App.store.listBookings({}).length;
  var lastBooking = window.App.store.listBookingsBySupplier(supId).slice(-1)[0];
  var dup = window.App.store.createBooking({
    rampId: lastBooking.rampId, date: lastBooking.date, start: lastBooking.start,
    supplierId: supId, supplierName: "X", email: "x@x.de", orderRef: "DUP-1", qty: 1
  });
  // Nur gültig, wenn Kapazität der Rampe = 1 (sonst darf eine zweite Buchung erlaubt sein)
  var ramp = window.App.store.getRamp(lastBooking.rampId);
  if (ramp.capacity === 1) ok(dup.ok === false, "Doppelbuchung auf Kapazität-1-Slot wird verhindert");
  else ok(true, "Slot-Kapazität > 1 – Mehrfachbuchung zulässig (übersprungen)");

} catch (e) {
  fail++; console.log("FAIL Ausnahme: " + (e && e.stack ? e.stack : e));
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
