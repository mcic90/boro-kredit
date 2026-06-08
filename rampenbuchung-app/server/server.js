/* ============================================================================
   RampSlot Full-Stack Server — Zero-Dependency (nur Node-Standardbibliothek)
   Start:  node server/server.js   ->  http://localhost:3000
   Persistenz: server/data.json  |  serviert die App aus rampenbuchung-app/
   Siehe server/API_CONTRACT.md
   ========================================================================== */
"use strict";
var http = require("http");
var fs = require("fs");
var path = require("path");

var PORT = process.env.PORT || 3000;
var APP_DIR = path.join(__dirname, "..");          // rampenbuchung-app/
var DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");

// ---- Zeit-/ID-Helfer (autoritativ, Logik wie store.js) --------------------
function pad(n) { return String(n).padStart(2, "0"); }
function toMin(hm) { var p = String(hm).split(":"); return (+p[0]) * 60 + (+p[1]); }
function toHM(min) { return pad(Math.floor(min / 60)) + ":" + pad(min % 60); }
function isoDate(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function today() { return isoDate(new Date()); }
function nowHM() { var d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
function uid(p) { return (p || "id") + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }

// ---- Persistenz + Seed ----------------------------------------------------
var db = null;

function seed() {
  var t = today();
  var d = new Date(); d.setDate(d.getDate() + 1);
  var tomorrow = isoDate(d);
  function mk(rampId, date, start, dur, supId, supName, email, ref, qty, notes) {
    return { id: uid("b"), rampId: rampId, date: date, start: start, end: toHM(toMin(start) + dur),
      supplierId: supId, supplierName: supName, email: email, carrier: supName,
      orderRef: ref, qty: qty, notes: notes || "", status: "bestaetigt", createdAt: Date.now() };
  }
  return {
    ramps: [
      { id: "r1", name: "Rampe 1 – Wareneingang", openFrom: "06:00", openTo: "18:00", slotMinutes: 30, capacity: 1, active: true },
      { id: "r2", name: "Rampe 2 – Warenausgang", openFrom: "07:00", openTo: "17:00", slotMinutes: 60, capacity: 1, active: true },
      { id: "r3", name: "Rampe 3 – Stückgut/Express", openFrom: "06:00", openTo: "14:00", slotMinutes: 30, capacity: 2, active: true }
    ],
    users: [
      { id: "u_admin", type: "admin", company: "Werk Karlsruhe", name: "Hof-Administration", email: "admin@demo.de", password: "demo", createdAt: Date.now() },
      { id: "u_sup1", type: "lieferant", company: "Müller Spedition GmbH", name: "Max Müller", email: "lieferant@demo.de", password: "demo", createdAt: Date.now() },
      { id: "u_sup2", type: "lieferant", company: "Nord-Logistik AG", name: "Sina Berg", email: "nord@demo.de", password: "demo", createdAt: Date.now() }
    ],
    bookings: [
      mk("r1", t, "08:00", 30, "u_sup1", "Müller Spedition GmbH", "lieferant@demo.de", "BE-100245", 12, ""),
      mk("r1", t, "09:30", 30, "u_sup2", "Nord-Logistik AG", "nord@demo.de", "BE-100250", 8, "Kühlware"),
      mk("r2", t, "10:00", 60, "u_sup1", "Müller Spedition GmbH", "lieferant@demo.de", "VK-55012", 24, ""),
      mk("r3", tomorrow, "07:00", 30, "u_sup2", "Nord-Logistik AG", "nord@demo.de", "BE-100262", 5, "Express")
    ],
    blocks: []
  };
}

function load() {
  try { db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch (e) { db = seed(); save(); }
}
function save() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch (e) { console.error("save failed", e); }
}
function stripPw(u) { return { id: u.id, type: u.type, company: u.company, name: u.name, email: u.email, createdAt: u.createdAt }; }

// ---- Domänenlogik (serverseitig autoritativ) ------------------------------
function getRamp(id) { return db.ramps.find(function (r) { return r.id === id; }); }
function activeBookingsAt(rampId, date, start) {
  return db.bookings.filter(function (b) {
    return b.rampId === rampId && b.date === date && b.start === start &&
      (b.status === "bestaetigt" || b.status === "erledigt");
  });
}
function blockAt(rampId, date, start, end) {
  return db.blocks.find(function (bl) {
    return bl.rampId === rampId && bl.date === date &&
      toMin(bl.start) <= toMin(start) && toMin(bl.end) >= toMin(end);
  });
}
function isPast(date, end) {
  var t = today();
  if (date < t) return true;
  if (date === t && toMin(end) <= toMin(nowHM())) return true;
  return false;
}

function createBooking(data) {
  var ramp = getRamp(data.rampId);
  if (!ramp) return { ok: false, code: 400, error: "Rampe nicht gefunden." };
  if (!data.date || !data.start) return { ok: false, code: 400, error: "Datum und Zeitfenster erforderlich." };
  if (!data.orderRef) return { ok: false, code: 400, error: "Bitte eine Bestell-/Referenznummer angeben." };
  var end = toHM(toMin(data.start) + ramp.slotMinutes);
  if (isPast(data.date, end)) return { ok: false, code: 409, error: "Dieses Zeitfenster liegt in der Vergangenheit." };
  if (blockAt(data.rampId, data.date, data.start, end)) return { ok: false, code: 409, error: "Dieses Zeitfenster ist gesperrt." };
  if (activeBookingsAt(data.rampId, data.date, data.start).length >= ramp.capacity)
    return { ok: false, code: 409, error: "Dieses Zeitfenster ist bereits ausgebucht." };
  var b = {
    id: uid("b"), rampId: data.rampId, date: data.date, start: data.start, end: end,
    supplierId: data.supplierId || null, supplierName: data.supplierName || "",
    email: data.email || "", carrier: data.carrier || data.supplierName || "",
    orderRef: data.orderRef, qty: +data.qty || 0, notes: data.notes || "",
    status: "bestaetigt", createdAt: Date.now()
  };
  db.bookings.push(b); save();
  return { ok: true, booking: b };
}

// ---- HTTP-Helfer ----------------------------------------------------------
function sendJson(res, status, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(body);
}
function readBody(req, cb) {
  var data = "";
  req.on("data", function (c) { data += c; if (data.length > 1e6) req.destroy(); });
  req.on("end", function () { try { cb(data ? JSON.parse(data) : {}); } catch (e) { cb(null); } });
}
var MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

function serveStatic(req, res, pathname) {
  var rel = pathname === "/" ? "index.server.html" : pathname.replace(/^\/+/, "");
  var filePath = path.normalize(path.join(APP_DIR, rel));
  if (filePath.indexOf(APP_DIR) !== 0) { res.writeHead(403); res.end("Forbidden"); return; }
  fs.readFile(filePath, function (err, buf) {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Not found: " + rel); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(buf);
  });
}

// ---- API-Router -----------------------------------------------------------
function handleApi(req, res, pathname) {
  var m = req.method;
  // /api/<resource>(/<id>)?
  var parts = pathname.split("/").filter(Boolean); // ['api','bookings','id?']
  var resource = parts[1], id = parts[2];

  if (m === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }); res.end(); return; }

  if (m === "GET" && resource === "bootstrap") {
    return sendJson(res, 200, { ramps: db.ramps, bookings: db.bookings, blocks: db.blocks, users: db.users.map(stripPw) });
  }

  if (m === "POST" && resource === "login") {
    return readBody(req, function (body) {
      if (!body) return sendJson(res, 400, { ok: false, error: "Ungültiger Body." });
      var u = db.users.find(function (x) { return x.email.toLowerCase() === String(body.email || "").toLowerCase(); });
      if (!u) return sendJson(res, 401, { ok: false, error: "Kein Konto mit dieser E-Mail gefunden." });
      if (u.password !== body.password) return sendJson(res, 401, { ok: false, error: "Passwort ist nicht korrekt." });
      sendJson(res, 200, { ok: true, user: stripPw(u) });
    });
  }

  if (m === "POST" && resource === "register") {
    return readBody(req, function (body) {
      if (!body || !body.company || !body.email || !body.password)
        return sendJson(res, 400, { ok: false, error: "Firma, E-Mail und Passwort sind erforderlich." });
      if (db.users.some(function (x) { return x.email.toLowerCase() === String(body.email).toLowerCase(); }))
        return sendJson(res, 409, { ok: false, error: "Diese E-Mail ist bereits registriert." });
      var u = { id: uid("u"), type: "lieferant", company: body.company, name: body.name || "", email: body.email, password: body.password, createdAt: Date.now() };
      db.users.push(u); save();
      sendJson(res, 200, { ok: true, user: stripPw(u) });
    });
  }

  if (resource === "ramps") {
    if (m === "POST") return readBody(req, function (b) {
      var r = { id: uid("r"), name: b.name || "Neue Rampe", openFrom: b.openFrom || "06:00", openTo: b.openTo || "18:00",
        slotMinutes: +b.slotMinutes || 30, capacity: +b.capacity || 1, active: b.active !== false };
      db.ramps.push(r); save(); sendJson(res, 200, { ok: true, ramp: r });
    });
    if (m === "PATCH") return readBody(req, function (b) {
      var r = getRamp(id); if (!r) return sendJson(res, 404, { ok: false, error: "Rampe nicht gefunden." });
      ["name", "openFrom", "openTo"].forEach(function (k) { if (b[k] != null) r[k] = b[k]; });
      if (b.slotMinutes != null) r.slotMinutes = +b.slotMinutes;
      if (b.capacity != null) r.capacity = +b.capacity;
      if (b.active != null) r.active = !!b.active;
      save(); sendJson(res, 200, { ok: true, ramp: r });
    });
    if (m === "DELETE") {
      var i = db.ramps.findIndex(function (r) { return r.id === id; });
      if (i < 0) return sendJson(res, 404, { ok: false, error: "Rampe nicht gefunden." });
      db.ramps.splice(i, 1);
      db.bookings = db.bookings.filter(function (b) { return b.rampId !== id; });
      db.blocks = db.blocks.filter(function (b) { return b.rampId !== id; });
      save(); return sendJson(res, 200, { ok: true });
    }
  }

  if (resource === "bookings") {
    if (m === "POST") return readBody(req, function (b) {
      if (!b) return sendJson(res, 400, { ok: false, error: "Ungültiger Body." });
      var r = createBooking(b);
      if (!r.ok) return sendJson(res, r.code || 409, { ok: false, error: r.error });
      sendJson(res, 200, { ok: true, booking: r.booking });
    });
    if (m === "PATCH") return readBody(req, function (b) {
      var bk = db.bookings.find(function (x) { return x.id === id; });
      if (!bk) return sendJson(res, 404, { ok: false, error: "Buchung nicht gefunden." });
      var allowed = ["bestaetigt", "storniert", "no_show", "erledigt"];
      if (allowed.indexOf(b.status) < 0) return sendJson(res, 400, { ok: false, error: "Ungültiger Status." });
      bk.status = b.status; save(); sendJson(res, 200, { ok: true, booking: bk });
    });
  }

  if (resource === "blocks") {
    if (m === "POST") return readBody(req, function (b) {
      var bl = { id: uid("bl"), rampId: b.rampId, date: b.date, start: b.start, end: b.end, reason: b.reason || "" };
      db.blocks.push(bl); save(); sendJson(res, 200, { ok: true, block: bl });
    });
    if (m === "DELETE") {
      var j = db.blocks.findIndex(function (x) { return x.id === id; });
      if (j < 0) return sendJson(res, 404, { ok: false, error: "Sperre nicht gefunden." });
      db.blocks.splice(j, 1); save(); return sendJson(res, 200, { ok: true });
    }
  }

  sendJson(res, 404, { ok: false, error: "Unbekannter Endpunkt." });
}

// ---- Server ---------------------------------------------------------------
load();
http.createServer(function (req, res) {
  var pathname = decodeURIComponent((req.url || "/").split("?")[0]);
  if (pathname.indexOf("/api") === 0) handleApi(req, res, pathname);
  else serveStatic(req, res, pathname);
}).listen(PORT, function () {
  console.log("RampSlot Full-Stack-Server läuft auf http://localhost:" + PORT);
  console.log("Demo-Login: lieferant@demo.de / demo  ·  admin@demo.de / demo");
});
