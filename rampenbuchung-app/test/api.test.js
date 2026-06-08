/* ============================================================================
   RampSlot REST-API — selbstständige, zero-dependency Node-Testsuite
   ----------------------------------------------------------------------------
   - Reines Node 22 (globales fetch). KEINE externen Pakete.
   - Startet server/server.js SELBST (eigener PORT 3999 + temporäre DATA_FILE),
     pollt /api/bootstrap bis bereit, fährt am Ende sauber herunter und löscht
     die Tempdatei. Die echte server/data.json wird NICHT angefasst.

   Ausführen aus dem App-Ordner:  node test/api.test.js
   ========================================================================== */
"use strict";
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

// ---- Konfiguration --------------------------------------------------------
const APP_ROOT = path.join(__dirname, "..");
const SERVER_JS = path.join("server", "server.js"); // relativ zu cwd = APP_ROOT
const PORT = "3999";
const BASE = "http://localhost:" + PORT;
const DATA_FILE = path.join(
  os.tmpdir(),
  "rampslot-test-" + process.pid + "-" + Date.now() + ".json"
);

// ---- Mini-Test-Framework --------------------------------------------------
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log("PASS " + msg); }
  else { fail++; console.log("FAIL " + msg); }
}

// ---- Helfer ---------------------------------------------------------------
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function req(method, p, body) {
  const opts = { method: method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + p, opts);
  let json = null;
  const text = await res.text();
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
  return { status: res.status, json: json };
}

function isoOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = function (n) { return String(n).padStart(2, "0"); };
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

// ---- Server-Lebenszyklus --------------------------------------------------
function startServer() {
  return spawn("node", [SERVER_JS], {
    cwd: APP_ROOT,
    env: Object.assign({}, process.env, { PORT: PORT, DATA_FILE: DATA_FILE }),
    stdio: ["ignore", "ignore", "inherit"]
  });
}

async function waitForReady() {
  for (let i = 0; i < 10; i++) {
    try {
      const r = await req("GET", "/api/bootstrap");
      if (r.status === 200) return true;
    } catch (e) { /* noch nicht erreichbar */ }
    await sleep(200);
  }
  return false;
}

function stopServer(child) {
  return new Promise(function (resolve) {
    if (!child || child.killed || child.exitCode !== null) return resolve();
    child.once("exit", function () { resolve(); });
    child.kill();
    // Sicherheitsnetz, falls 'exit' ausbleibt
    setTimeout(resolve, 1500);
  });
}

function cleanupDataFile() {
  try { fs.unlinkSync(DATA_FILE); } catch (e) { /* egal */ }
}

// ---- Testlauf -------------------------------------------------------------
async function main() {
  let child = startServer();

  const ready = await waitForReady();
  ok(ready, "Server gestartet und /api/bootstrap erreichbar");
  if (!ready) {
    await stopServer(child);
    cleanupDataFile();
    finish();
    return;
  }

  // -- 1) Bootstrap: Seed-Daten, Users ohne Passwort -----------------------
  {
    const r = await req("GET", "/api/bootstrap");
    ok(r.status === 200, "1) GET /api/bootstrap -> 200");
    const b = r.json || {};
    const ramps = b.ramps || [];
    const users = b.users || [];
    const ids = ramps.map(function (x) { return x.id; });
    ok(ramps.length === 3 && ids.indexOf("r1") > -1 && ids.indexOf("r2") > -1 && ids.indexOf("r3") > -1,
      "1) enthält 3 Seed-Rampen r1,r2,r3");
    ok(users.length === 3, "1) enthält 3 Seed-Users");
    ok(users.length > 0 && users.every(function (u) { return !("password" in u); }),
      "1) users OHNE password-Feld");
  }

  // -- 2) Login admin korrekt ----------------------------------------------
  {
    const r = await req("POST", "/api/login", { email: "admin@demo.de", password: "demo" });
    ok(r.status === 200 && r.json && r.json.ok === true, "2) POST /api/login (admin) -> 200 ok:true");
    ok(r.json && r.json.user && r.json.user.type === "admin", "2) user.type=admin");
    ok(r.json && r.json.user && !("password" in r.json.user), "2) kein password im user");
  }

  // -- 3) Login falsches Passwort ------------------------------------------
  {
    const r = await req("POST", "/api/login", { email: "admin@demo.de", password: "falsch" });
    ok(r.status === 401 && r.json && r.json.ok === false, "3) POST /api/login (falsches PW) -> 401 ok:false");
  }

  // -- 4) Register neu, dann Duplikat --------------------------------------
  {
    const email = "neu_" + Date.now() + "@demo.de";
    const r1 = await req("POST", "/api/register",
      { company: "Test GmbH", name: "Test Person", email: email, password: "geheim" });
    ok(r1.status === 200 && r1.json && r1.json.ok === true, "4) POST /api/register (neu) -> 200 ok:true");
    const r2 = await req("POST", "/api/register",
      { company: "Test GmbH", name: "Test Person", email: email, password: "geheim" });
    ok(r2.status === 409 && r2.json && r2.json.ok === false, "4) POST /api/register (Duplikat) -> 409 ok:false");
  }

  // -- 5) Rampe anlegen ----------------------------------------------------
  let rampId = null;
  {
    const r = await req("POST", "/api/ramps",
      { name: "Testrampe", openFrom: "06:00", openTo: "08:00", slotMinutes: 60, capacity: 1 });
    ok(r.status === 200 && r.json && r.json.ok === true, "5) POST /api/ramps -> 200 ok:true");
    ok(r.json && r.json.ramp && !!r.json.ramp.id, "5) ramp.id vorhanden");
    rampId = r.json && r.json.ramp ? r.json.ramp.id : null;
  }

  const tomorrow = isoOffset(1);

  // -- 6) Buchung auf freien zukünftigen Slot ------------------------------
  let bookingId = null;
  {
    const r = await req("POST", "/api/bookings",
      { rampId: rampId, date: tomorrow, start: "06:00", supplierName: "Müller", email: "m@x.de", orderRef: "REF-1", qty: 5 });
    ok(r.status === 200 && r.json && r.json.ok === true, "6) POST /api/bookings (freier Slot) -> 200 ok:true");
    bookingId = r.json && r.json.booking ? r.json.booking.id : null;
  }

  // -- 7) Gleicher Slot erneut (capacity 1) -> Konflikt --------------------
  {
    const r = await req("POST", "/api/bookings",
      { rampId: rampId, date: tomorrow, start: "06:00", supplierName: "Zweiter", orderRef: "REF-2", qty: 1 });
    ok(r.status === 409 && r.json && r.json.ok === false, "7) POST /api/bookings (ausgebucht) -> 409 ok:false");
  }

  // -- 8) Buchung ohne orderRef -> 400 -------------------------------------
  {
    const r = await req("POST", "/api/bookings",
      { rampId: rampId, date: tomorrow, start: "07:00", supplierName: "OhneRef", qty: 1 });
    ok(r.status === 400 && r.json && r.json.ok === false, "8) POST /api/bookings (ohne orderRef) -> 400 ok:false");
  }

  // -- 9) Buchung in der Vergangenheit -> 409 ------------------------------
  {
    const r = await req("POST", "/api/bookings",
      { rampId: rampId, date: "2000-01-01", start: "06:00", supplierName: "Past", orderRef: "REF-PAST", qty: 1 });
    ok(r.status === 409 && r.json && r.json.ok === false, "9) POST /api/bookings (Vergangenheit) -> 409 ok:false");
  }

  // -- 10) Stornieren -> Slot wieder frei ----------------------------------
  {
    const r1 = await req("PATCH", "/api/bookings/" + bookingId, { status: "storniert" });
    ok(r1.status === 200 && r1.json && r1.json.ok === true, "10) PATCH /api/bookings/:id storniert -> 200 ok:true");
    const r2 = await req("POST", "/api/bookings",
      { rampId: rampId, date: tomorrow, start: "06:00", supplierName: "Nachrücker", orderRef: "REF-3", qty: 1 });
    ok(r2.status === 200 && r2.json && r2.json.ok === true, "10) Slot nach Storno wieder frei -> 200 ok:true");
  }

  // -- 11) Block setzen -> Buchung gesperrt -> Block löschen ---------------
  {
    const r1 = await req("POST", "/api/blocks",
      { rampId: rampId, date: tomorrow, start: "07:00", end: "08:00", reason: "Wartung" });
    ok(r1.status === 200 && r1.json && r1.json.ok === true, "11) POST /api/blocks -> 200 ok:true");
    const blockId = r1.json && r1.json.block ? r1.json.block.id : null;

    const r2 = await req("POST", "/api/bookings",
      { rampId: rampId, date: tomorrow, start: "07:00", supplierName: "Blocked", orderRef: "REF-BLK", qty: 1 });
    ok(r2.status === 409 && r2.json && r2.json.ok === false, "11) POST /api/bookings (gesperrt) -> 409 ok:false");

    const r3 = await req("DELETE", "/api/blocks/" + blockId);
    ok(r3.status === 200 && r3.json && r3.json.ok === true, "11) DELETE /api/blocks/:id -> 200 ok:true");
  }

  // -- 12) Rampe löschen -> kaskadiert Buchungen ---------------------------
  {
    const r1 = await req("DELETE", "/api/ramps/" + rampId);
    ok(r1.status === 200 && r1.json && r1.json.ok === true, "12) DELETE /api/ramps/:id -> 200 ok:true");
    const r2 = await req("GET", "/api/bootstrap");
    const b = r2.json || {};
    const rampGone = (b.ramps || []).every(function (x) { return x.id !== rampId; });
    const bookingsGone = (b.bookings || []).every(function (x) { return x.rampId !== rampId; });
    ok(rampGone, "12) Rampe nach DELETE entfernt");
    ok(bookingsGone, "12) Buchungen der Rampe kaskadiert entfernt");
  }

  // -- 13) Persistenz: Server neu starten, Mutation muss bleiben -----------
  {
    // Mutation, die persistiert werden soll: neue Rampe anlegen
    const created = await req("POST", "/api/ramps", { name: "Persistenzrampe", slotMinutes: 30, capacity: 1 });
    const persistId = created.json && created.json.ramp ? created.json.ramp.id : null;
    ok(created.status === 200 && !!persistId, "13) Vorbereitung: Persistenzrampe angelegt");

    // Server stoppen und mit GLEICHER DATA_FILE neu starten
    await stopServer(child);
    child = startServer();
    const readyAgain = await waitForReady();
    ok(readyAgain, "13) Server nach Neustart wieder bereit");

    const after = await req("GET", "/api/bootstrap");
    const stillThere = ((after.json && after.json.ramps) || []).some(function (x) { return x.id === persistId; });
    ok(stillThere, "13) Mutation nach Neustart noch vorhanden (Persistenz)");
  }

  // ---- Aufräumen ---------------------------------------------------------
  await stopServer(child);
  cleanupDataFile();
  finish();
}

function finish() {
  console.log("RESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}

// Robustheit: bei unerwartetem Fehler trotzdem aufräumen
process.on("uncaughtException", function (e) {
  console.log("FAIL unerwarteter Fehler: " + (e && e.message));
  fail++;
  cleanupDataFile();
  finish();
});
process.on("unhandledRejection", function (e) {
  console.log("FAIL unbehandelte Rejection: " + (e && e.message));
  fail++;
  cleanupDataFile();
  finish();
});

main();
