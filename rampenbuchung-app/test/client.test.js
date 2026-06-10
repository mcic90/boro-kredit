/* End-to-End-Test des Full-Stack-CLIENTS (js/store.api.js) gegen einen echten Server.
   Spawnt server/server.js (eigener Port + Temp-Datendatei), shimmt window+fetch,
   lädt store.api.js und prüft Hydration, Lese-Logik, Write-Through und Konfliktprüfung.
   Start aus dem App-Ordner:  node test/client.test.js   (oder via npm)  */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const PORT = 4011;
const BASE = "http://localhost:" + PORT;
const TMP = path.join(os.tmpdir(), "rampslot-client-" + process.pid + ".json");
const APP_ROOT = process.cwd();

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log("PASS " + m); } else { fail++; console.log("FAIL " + m); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

(async function () {
  const child = spawn("node", ["server/server.js"], {
    cwd: APP_ROOT, env: Object.assign({}, process.env, { PORT: String(PORT), DATA_FILE: TMP }), stdio: "ignore"
  });

  const realFetch = global.fetch;
  function shimFetch(p, opts) { return realFetch(/^https?:/.test(p) ? p : BASE + p, opts); }

  try {
    // auf Server-Bereitschaft warten
    let up = false;
    for (let i = 0; i < 20 && !up; i++) {
      try { const r = await realFetch(BASE + "/api/bootstrap"); if (r.ok) up = true; } catch (e) { await sleep(200); }
    }
    ok(up, "Server gestartet und erreichbar");

    // Browser-Globals shimmen und store.api.js laden
    const sandbox = {
      window: { App: { ui: { toast: function () {} } } },
      fetch: shimFetch, console: console, setTimeout: setTimeout, clearTimeout: clearTimeout
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    const code = fs.readFileSync(path.join(APP_ROOT, "js/store.api.js"), "utf8");
    vm.runInContext(code, sandbox, { filename: "store.api.js" });
    const store = sandbox.window.App.store;
    ok(store && typeof store.init === "function", "window.App.store registriert");

    // API-Oberfläche vorhanden?
    const need = ["init", "listRamps", "getRamp", "getDaySlots", "createBooking", "listBookings",
      "listBookingsBySupplier", "cancelBooking", "setBookingStatus", "addBlock", "removeBlock",
      "createRamp", "updateRamp", "deleteRamp", "listUsers", "kpisForDate", "today"];
    ok(need.every((k) => typeof store[k] === "function"), "store.api implementiert die komplette store-API");

    // Hydration
    await store.init();
    ok(store.listRamps().length === 3, "init() hydratisiert Cache vom Server (3 Rampen)");
    ok(store.listUsers("lieferant").length >= 2, "Lieferanten aus /api/bootstrap im Cache");

    // Lese-Logik: freie Slots morgen
    const tomorrow = iso(new Date(Date.now() + 86400000));
    const slots = store.getDaySlots("r1", tomorrow);
    ok(Array.isArray(slots) && slots.length > 0, "getDaySlots liefert Slots");
    const free = slots.find((s) => s.status === "frei");
    ok(free, "mind. ein freier Slot morgen");

    // Buchung (optimistisch sync) + Write-Through
    const before = store.listBookings({}).length;
    const res = store.createBooking({
      rampId: "r1", date: tomorrow, start: free.start, supplierId: "u_sup1",
      supplierName: "Test GmbH", email: "t@t.de", orderRef: "CLIENT-1", qty: 3
    });
    ok(res && res.ok === true, "createBooking gibt synchron {ok:true} zurück (optimistisch)");
    ok(store.listBookings({}).length === before + 1, "Buchung sofort im Cache sichtbar");

    await sleep(400); // Write-Through abwarten
    const srv = await (await realFetch(BASE + "/api/bootstrap")).json();
    ok(srv.bookings.some((b) => b.orderRef === "CLIENT-1"), "Write-Through: Buchung wurde am Server persistiert");

    // Optimistische Konfliktprüfung (capacity 1)
    const dup = store.createBooking({
      rampId: "r1", date: tomorrow, start: free.start, supplierId: "u_sup1",
      supplierName: "Test GmbH", email: "t@t.de", orderRef: "CLIENT-2", qty: 1
    });
    ok(dup && dup.ok === false, "Doppelbuchung wird clientseitig (Cache) verhindert");

    // Fehlende Referenznummer
    const noRef = store.createBooking({ rampId: "r1", date: tomorrow, start: free.start, supplierId: "u_sup1", supplierName: "X", orderRef: "" });
    ok(noRef && noRef.ok === false, "createBooking ohne orderRef -> {ok:false}");

  } catch (e) {
    fail++; console.log("FAIL Ausnahme: " + (e && e.stack ? e.stack : e));
  } finally {
    child.kill();
    try { fs.unlinkSync(TMP); } catch (e) {}
  }

  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
