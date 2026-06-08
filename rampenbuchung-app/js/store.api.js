/* ============================================================================
   store.api.js — Daten + Domänenlogik (Full-Stack-Variante)
   Persistenz: REST-API (server/server.js). Lese-Logik 1:1 wie store.js,
   Mutationen = optimistische Cache-Änderung + async Write-Through.
   Exporte: window.App.store   (gleiche Signaturen wie store.js)
   ========================================================================== */
(function () {
  "use strict";
  window.App = window.App || {};

  // ---- Zeit-/ID-Helfer (identisch zu store.js) -----------------------------
  function pad(n) { return String(n).padStart(2, "0"); }
  function toMin(hm) { var p = hm.split(":"); return (+p[0]) * 60 + (+p[1]); }
  function toHM(min) { return pad(Math.floor(min / 60)) + ":" + pad(min % 60); }
  function isoDate(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function uid(prefix) { return (prefix || "id") + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }

  function today() { return isoDate(new Date()); }
  function nowHM() { var d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }

  // ---- State (In-Memory-Cache) ---------------------------------------------
  var state = { ramps: [], bookings: [], blocks: [], users: [], session: null };

  // ---- API-Helfer ----------------------------------------------------------
  // Promise-basierter fetch-Wrapper. Wirft bei !ok, damit Aufrufer fangen kann.
  function api(method, path, body) {
    var opts = { method: method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined && body !== null) opts.body = JSON.stringify(body);
    return fetch(path, opts).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || (data && data.ok === false)) {
          var err = new Error((data && data.error) || ("HTTP " + res.status));
          err.payload = data;
          throw err;
        }
        return data;
      });
    });
  }

  // Nach fehlgeschlagenem Write: Server-Wahrheit neu laden und UI neu rendern.
  function resync() {
    return init().then(function () { rerender(); });
  }

  // Re-Render anstoßen, falls der Router (app.server.js) lauscht.
  function rerender() {
    try {
      if (typeof window.dispatchEvent === "function" && typeof HashChangeEvent === "function") {
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      } else if (typeof window.dispatchEvent === "function") {
        window.dispatchEvent(new Event("hashchange"));
      }
    } catch (e) { /* ignore */ }
  }

  // ---- Init / Hydration ----------------------------------------------------
  // ASYNC: lädt den Cache via GET /api/bootstrap. Resolved auch bei Fehler.
  function init() {
    return fetch("/api/bootstrap")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        state.ramps = (data && data.ramps) || [];
        state.bookings = (data && data.bookings) || [];
        state.blocks = (data && data.blocks) || [];
        state.users = (data && data.users) || [];
        state.session = state.session || null;
      })
      .catch(function (e) {
        if (window.console) console.error("bootstrap failed", e);
        state.ramps = [];
        state.bookings = [];
        state.blocks = [];
        state.users = [];
        state.session = state.session || null;
      });
  }

  // ---- Rampen (Lesen identisch zu store.js) --------------------------------
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
    state.ramps.push(r);
    var tempId = r.id;
    api("POST", "/api/ramps", {
      name: r.name, openFrom: r.openFrom, openTo: r.openTo,
      slotMinutes: r.slotMinutes, capacity: r.capacity, active: r.active
    }).then(function (resp) {
      if (resp && resp.ramp) {
        var cur = getRamp(tempId);
        if (cur) {
          var oldId = cur.id;
          Object.keys(resp.ramp).forEach(function (k) { cur[k] = resp.ramp[k]; });
          // Falls die Server-id abweicht: lokale Referenzen mitziehen.
          if (oldId !== cur.id) {
            state.bookings.forEach(function (b) { if (b.rampId === oldId) b.rampId = cur.id; });
            state.blocks.forEach(function (bl) { if (bl.rampId === oldId) bl.rampId = cur.id; });
          }
        }
      }
    }).catch(function (e) {
      if (window.console) console.error("createRamp failed", e);
      var i = state.ramps.findIndex(function (x) { return x.id === tempId; });
      if (i >= 0) state.ramps.splice(i, 1);
      if (window.App.ui && window.App.ui.toast) window.App.ui.toast(e.message || "Rampe konnte nicht angelegt werden.", "error");
      resync();
    });
    return r;
  }

  function updateRamp(id, data) {
    var r = getRamp(id); if (!r) return null;
    var prev = JSON.parse(JSON.stringify(r));
    ["name", "openFrom", "openTo"].forEach(function (k) { if (data[k] != null) r[k] = data[k]; });
    if (data.slotMinutes != null) r.slotMinutes = +data.slotMinutes;
    if (data.capacity != null) r.capacity = +data.capacity;
    if (data.active != null) r.active = !!data.active;
    api("PATCH", "/api/ramps/" + id, data).then(function (resp) {
      if (resp && resp.ramp) {
        var cur = getRamp(id);
        if (cur) Object.keys(resp.ramp).forEach(function (k) { cur[k] = resp.ramp[k]; });
      }
    }).catch(function (e) {
      if (window.console) console.error("updateRamp failed", e);
      var cur = getRamp(id);
      if (cur) Object.keys(prev).forEach(function (k) { cur[k] = prev[k]; });
      if (window.App.ui && window.App.ui.toast) window.App.ui.toast(e.message || "Rampe konnte nicht aktualisiert werden.", "error");
      resync();
    });
    return r;
  }

  function deleteRamp(id) {
    var i = state.ramps.findIndex(function (r) { return r.id === id; });
    if (i < 0) return false;
    // Optimistisch lokal kaskadieren (wie store.js); Snapshot für Rollback.
    var prevRamps = state.ramps.slice();
    var prevBookings = state.bookings.slice();
    var prevBlocks = state.blocks.slice();
    state.ramps.splice(i, 1);
    state.bookings = state.bookings.filter(function (b) { return b.rampId !== id; });
    state.blocks = state.blocks.filter(function (b) { return b.rampId !== id; });
    api("DELETE", "/api/ramps/" + id).catch(function (e) {
      if (window.console) console.error("deleteRamp failed", e);
      state.ramps = prevRamps;
      state.bookings = prevBookings;
      state.blocks = prevBlocks;
      if (window.App.ui && window.App.ui.toast) window.App.ui.toast(e.message || "Rampe konnte nicht gelöscht werden.", "error");
      resync();
    });
    return true;
  }

  // ---- Slots (identisch zu store.js) ---------------------------------------
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
    state.bookings.push(b);
    var tempId = b.id;
    // Write-Through im Hintergrund.
    api("POST", "/api/bookings", {
      rampId: b.rampId, date: b.date, start: b.start, supplierId: b.supplierId,
      supplierName: b.supplierName, email: b.email, carrier: b.carrier,
      orderRef: b.orderRef, qty: b.qty, notes: b.notes
    }).then(function (resp) {
      if (resp && resp.booking) {
        var cur = state.bookings.find(function (x) { return x.id === tempId; });
        if (cur) Object.keys(resp.booking).forEach(function (k) { cur[k] = resp.booking[k]; });
      }
    }).catch(function (e) {
      if (window.console) console.error("createBooking failed", e);
      var i = state.bookings.findIndex(function (x) { return x.id === tempId; });
      if (i >= 0) state.bookings.splice(i, 1);
      if (window.App.ui && window.App.ui.toast) window.App.ui.toast(e.message || "Buchung konnte nicht gespeichert werden.", "error");
      resync();
    });
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
    var prev = b.status;
    b.status = status;
    api("PATCH", "/api/bookings/" + id, { status: status }).then(function (resp) {
      if (resp && resp.booking) {
        var cur = getBooking(id);
        if (cur) Object.keys(resp.booking).forEach(function (k) { cur[k] = resp.booking[k]; });
      }
    }).catch(function (e) {
      if (window.console) console.error("setBookingStatus failed", e);
      var cur = getBooking(id);
      if (cur) cur.status = prev;
      if (window.App.ui && window.App.ui.toast) window.App.ui.toast(e.message || "Status konnte nicht geändert werden.", "error");
      resync();
    });
    return true;
  }

  // ---- Sperren -------------------------------------------------------------
  function addBlock(rampId, date, start, end, reason) {
    var bl = { id: uid("bl"), rampId: rampId, date: date, start: start, end: end, reason: reason || "" };
    state.blocks.push(bl);
    var tempId = bl.id;
    api("POST", "/api/blocks", { rampId: rampId, date: date, start: start, end: end, reason: bl.reason })
      .then(function (resp) {
        if (resp && resp.block) {
          var cur = state.blocks.find(function (x) { return x.id === tempId; });
          if (cur) Object.keys(resp.block).forEach(function (k) { cur[k] = resp.block[k]; });
        }
      }).catch(function (e) {
        if (window.console) console.error("addBlock failed", e);
        var i = state.blocks.findIndex(function (x) { return x.id === tempId; });
        if (i >= 0) state.blocks.splice(i, 1);
        if (window.App.ui && window.App.ui.toast) window.App.ui.toast(e.message || "Sperre konnte nicht angelegt werden.", "error");
        resync();
      });
    return bl;
  }

  function removeBlock(id) {
    var i = state.blocks.findIndex(function (b) { return b.id === id; });
    if (i < 0) return false;
    var removed = state.blocks[i];
    state.blocks.splice(i, 1);
    api("DELETE", "/api/blocks/" + id).catch(function (e) {
      if (window.console) console.error("removeBlock failed", e);
      state.blocks.push(removed);
      if (window.App.ui && window.App.ui.toast) window.App.ui.toast(e.message || "Sperre konnte nicht entfernt werden.", "error");
      resync();
    });
    return true;
  }

  // ---- Benutzer ------------------------------------------------------------
  function listUsers(type) {
    return state.users.filter(function (u) { return !type || u.type === type; });
  }
  function getUser(id) { return state.users.find(function (u) { return u.id === id; }); }
  function getUserByEmail(email) {
    return state.users.find(function (u) { return u.email.toLowerCase() === String(email).toLowerCase(); });
  }
  // Anlage erfolgt serverseitig über auth.register; hier nur lokaler Cache-Eintrag.
  function createUser(data) {
    var u = {
      id: data.id || uid("u"), type: data.type || "lieferant", company: data.company || "",
      name: data.name || "", email: data.email || "",
      createdAt: data.createdAt || Date.now()
    };
    state.users.push(u);
    return u;
  }

  // ---- KPIs (identisch zu store.js) ----------------------------------------
  function kpisForDate(date) {
    var ramps = listRamps(true);
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
    init: init,
    reset: function () { if (window.console) console.info("store.reset(): Persistenz liegt am Server – No-Op."); },
    save: function () { /* no-op: Persistenz liegt am Server */ },
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
