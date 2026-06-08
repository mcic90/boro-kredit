/* ============================================================================
   store.js — Daten + Domänenlogik (Backbone)
   Persistenz: localStorage. Kein Build, kein Backend nötig.
   Exporte: window.App.store
   ========================================================================== */
(function () {
  "use strict";
  window.App = window.App || {};

  var STORE_KEY = "rampslot_v1";

  // ---- Zeit-Helfer ---------------------------------------------------------
  function pad(n) { return String(n).padStart(2, "0"); }
  function toMin(hm) { var p = hm.split(":"); return (+p[0]) * 60 + (+p[1]); }
  function toHM(min) { return pad(Math.floor(min / 60)) + ":" + pad(min % 60); }
  function isoDate(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function uid(prefix) { return (prefix || "id") + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }

  function today() { return isoDate(new Date()); }
  function nowHM() { var d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }

  // ---- State ---------------------------------------------------------------
  var state = null;

  function seed() {
    var t = today();
    var d = new Date(); d.setDate(d.getDate() + 1);
    var tomorrow = isoDate(d);

    var ramps = [
      { id: "r1", name: "Rampe 1 – Wareneingang", openFrom: "06:00", openTo: "18:00", slotMinutes: 30, capacity: 1, active: true },
      { id: "r2", name: "Rampe 2 – Warenausgang", openFrom: "07:00", openTo: "17:00", slotMinutes: 60, capacity: 1, active: true },
      { id: "r3", name: "Rampe 3 – Stückgut/Express", openFrom: "06:00", openTo: "14:00", slotMinutes: 30, capacity: 2, active: true }
    ];

    var users = [
      { id: "u_admin", type: "admin", company: "Werk Karlsruhe", name: "Hof-Administration", email: "admin@demo.de", password: "demo", createdAt: Date.now() },
      { id: "u_sup1", type: "lieferant", company: "Müller Spedition GmbH", name: "Max Müller", email: "lieferant@demo.de", password: "demo", createdAt: Date.now() },
      { id: "u_sup2", type: "lieferant", company: "Nord-Logistik AG", name: "Sina Berg", email: "nord@demo.de", password: "demo", createdAt: Date.now() }
    ];

    var bookings = [
      mkBooking("r1", t, "08:00", 30, "u_sup1", "Müller Spedition GmbH", "lieferant@demo.de", "Müller Spedition GmbH", "BE-100245", 12, ""),
      mkBooking("r1", t, "09:30", 30, "u_sup2", "Nord-Logistik AG", "nord@demo.de", "Nord-Logistik AG", "BE-100250", 8, "Kühlware"),
      mkBooking("r2", t, "10:00", 60, "u_sup1", "Müller Spedition GmbH", "lieferant@demo.de", "Müller Spedition GmbH", "VK-55012", 24, ""),
      mkBooking("r3", tomorrow, "07:00", 30, "u_sup2", "Nord-Logistik AG", "nord@demo.de", "Nord-Logistik AG", "BE-100262", 5, "Express")
    ];

    return { ramps: ramps, users: users, bookings: bookings, blocks: [], session: null };
  }

  function mkBooking(rampId, date, start, dur, supplierId, supplierName, email, carrier, orderRef, qty, notes) {
    return {
      id: uid("b"), rampId: rampId, date: date, start: start, end: toHM(toMin(start) + dur),
      supplierId: supplierId, supplierName: supplierName, email: email, carrier: carrier,
      orderRef: orderRef, qty: qty, notes: notes || "", status: "bestaetigt", createdAt: Date.now()
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) { state = JSON.parse(raw); return; }
    } catch (e) { /* ignore */ }
    state = seed();
    save();
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  // ---- Rampen --------------------------------------------------------------
  function listRamps(activeOnly) {
    var rs = state.ramps.slice();
    if (activeOnly) rs = rs.filter(function (r) { return r.active; });
    return rs;
  }
  function getRamp(id) { return state.ramps.find(function (r) { return r.id === id; }); }
  function createRamp(data) {
    var r = {
      id: uid("r"), name: data.name || "Neue Rampe",
      openFrom: data.openFrom || "06:00", openTo: data.openTo || "18:00",
      slotMinutes: +data.slotMinutes || 30, capacity: +data.capacity || 1,
      active: data.active !== false
    };
    state.ramps.push(r); save(); return r;
  }
  function updateRamp(id, data) {
    var r = getRamp(id); if (!r) return null;
    ["name", "openFrom", "openTo"].forEach(function (k) { if (data[k] != null) r[k] = data[k]; });
    if (data.slotMinutes != null) r.slotMinutes = +data.slotMinutes;
    if (data.capacity != null) r.capacity = +data.capacity;
    if (data.active != null) r.active = !!data.active;
    save(); return r;
  }
  function deleteRamp(id) {
    var i = state.ramps.findIndex(function (r) { return r.id === id; });
    if (i < 0) return false;
    state.ramps.splice(i, 1);
    state.bookings = state.bookings.filter(function (b) { return b.rampId !== id; });
    state.blocks = state.blocks.filter(function (b) { return b.rampId !== id; });
    save(); return true;
  }

  // ---- Slots ---------------------------------------------------------------
  function rawSlots(ramp) {
    var out = [], cur = toMin(ramp.openFrom), end = toMin(ramp.openTo);
    while (cur + ramp.slotMinutes <= end) {
      out.push({ start: toHM(cur), end: toHM(cur + ramp.slotMinutes) });
      cur += ramp.slotMinutes;
    }
    return out;
  }

  function activeBookingsAt(rampId, date, start) {
    return state.bookings.filter(function (b) {
      return b.rampId === rampId && b.date === date && b.start === start &&
        (b.status === "bestaetigt" || b.status === "erledigt");
    });
  }

  function blockAt(rampId, date, start, end) {
    return state.blocks.find(function (bl) {
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

  function getDaySlots(rampId, date) {
    var ramp = getRamp(rampId); if (!ramp) return [];
    return rawSlots(ramp).map(function (s) {
      var bks = activeBookingsAt(rampId, date, s.start);
      var block = blockAt(rampId, date, s.start, s.end);
      var status;
      if (isPast(date, s.end)) status = "vergangen";
      else if (block) status = "gesperrt";
      else if (bks.length >= ramp.capacity) status = "belegt";
      else status = "frei";
      return {
        start: s.start, end: s.end, status: status,
        booked: bks.length, capacity: ramp.capacity, bookings: bks, block: block || null
      };
    });
  }

  // ---- Buchungen -----------------------------------------------------------
  function createBooking(data) {
    var ramp = getRamp(data.rampId);
    if (!ramp) return { ok: false, error: "Rampe nicht gefunden." };
    if (!data.date || !data.start) return { ok: false, error: "Datum und Zeitfenster erforderlich." };
    var dur = ramp.slotMinutes;
    var end = toHM(toMin(data.start) + dur);
    if (isPast(data.date, end)) return { ok: false, error: "Dieses Zeitfenster liegt in der Vergangenheit." };
    if (blockAt(data.rampId, data.date, data.start, end)) return { ok: false, error: "Dieses Zeitfenster ist gesperrt." };
    var bks = activeBookingsAt(data.rampId, data.date, data.start);
    if (bks.length >= ramp.capacity) return { ok: false, error: "Dieses Zeitfenster ist bereits ausgebucht." };
    if (!data.orderRef) return { ok: false, error: "Bitte eine Bestell-/Referenznummer angeben." };

    var b = {
      id: uid("b"), rampId: data.rampId, date: data.date, start: data.start, end: end,
      supplierId: data.supplierId || null, supplierName: data.supplierName || "",
      email: data.email || "", carrier: data.carrier || data.supplierName || "",
      orderRef: data.orderRef, qty: +data.qty || 0, notes: data.notes || "",
      status: "bestaetigt", createdAt: Date.now()
    };
    state.bookings.push(b); save();
    return { ok: true, booking: b };
  }

  function sortBookings(list) {
    return list.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return toMin(a.start) - toMin(b.start);
    });
  }

  function listBookings(filter) {
    filter = filter || {};
    var out = state.bookings.filter(function (b) {
      if (filter.date && b.date !== filter.date) return false;
      if (filter.rampId && b.rampId !== filter.rampId) return false;
      if (filter.status && b.status !== filter.status) return false;
      if (filter.supplierId && b.supplierId !== filter.supplierId) return false;
      return true;
    });
    return sortBookings(out);
  }
  function listBookingsBySupplier(supplierId) { return listBookings({ supplierId: supplierId }); }
  function getBooking(id) { return state.bookings.find(function (b) { return b.id === id; }); }

  function cancelBooking(id) { return setBookingStatus(id, "storniert"); }
  function setBookingStatus(id, status) {
    var b = getBooking(id); if (!b) return false;
    b.status = status; save(); return true;
  }

  // ---- Sperren -------------------------------------------------------------
  function addBlock(rampId, date, start, end, reason) {
    var bl = { id: uid("bl"), rampId: rampId, date: date, start: start, end: end, reason: reason || "" };
    state.blocks.push(bl); save(); return bl;
  }
  function removeBlock(id) {
    var i = state.blocks.findIndex(function (b) { return b.id === id; });
    if (i < 0) return false;
    state.blocks.splice(i, 1); save(); return true;
  }

  // ---- Benutzer ------------------------------------------------------------
  function listUsers(type) {
    return state.users.filter(function (u) { return !type || u.type === type; });
  }
  function getUser(id) { return state.users.find(function (u) { return u.id === id; }); }
  function getUserByEmail(email) {
    return state.users.find(function (u) { return u.email.toLowerCase() === String(email).toLowerCase(); });
  }
  function createUser(data) {
    var u = {
      id: uid("u"), type: data.type || "lieferant", company: data.company || "",
      name: data.name || "", email: data.email || "", password: data.password || "",
      createdAt: Date.now()
    };
    state.users.push(u); save(); return u;
  }

  // ---- KPIs ----------------------------------------------------------------
  function kpisForDate(date) {
    var ramps = listRamps(true);
    var capacity = 0;
    ramps.forEach(function (r) {
      rawSlots(r).forEach(function (s) {
        if (!isPast(date, s.end)) capacity += r.capacity;
      });
    });
    var dayBookings = listBookings({ date: date });
    var active = dayBookings.filter(function (b) { return b.status === "bestaetigt" || b.status === "erledigt"; });
    var noShows = dayBookings.filter(function (b) { return b.status === "no_show"; }).length;
    var totalSlotsCap = 0;
    ramps.forEach(function (r) { totalSlotsCap += rawSlots(r).length * r.capacity; });
    var utilization = totalSlotsCap ? active.length / totalSlotsCap : 0;
    var upcoming = active.filter(function (b) { return !isPast(b.date, b.end); }).length;
    return { bookings: active.length, capacity: totalSlotsCap, utilization: utilization, noShows: noShows, upcoming: upcoming };
  }

  // ---- öffentliche API -----------------------------------------------------
  window.App.store = {
    init: load, reset: function () { state = seed(); save(); }, save: save,
    getState: function () { return state; },
    today: today, nowHM: nowHM, _toMin: toMin, _toHM: toHM,
    listRamps: listRamps, getRamp: getRamp, createRamp: createRamp, updateRamp: updateRamp, deleteRamp: deleteRamp,
    getDaySlots: getDaySlots,
    createBooking: createBooking, listBookings: listBookings, listBookingsBySupplier: listBookingsBySupplier,
    getBooking: getBooking, cancelBooking: cancelBooking, setBookingStatus: setBookingStatus,
    addBlock: addBlock, removeBlock: removeBlock,
    listUsers: listUsers, getUser: getUser, getUserByEmail: getUserByEmail, createUser: createUser,
    kpisForDate: kpisForDate
  };
})();
