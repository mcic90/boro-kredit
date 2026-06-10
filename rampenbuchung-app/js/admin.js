/* ============================================================================
   admin.js — Admin-/Verlader-Views (Agent)
   Exporte: window.App.views.admin
   Routen: uebersicht, kalender, rampen, buchungen, lieferanten
   ctx = { user, store, ui, navigate(hash), refresh() }
   ========================================================================== */
(function () {
  "use strict";
  window.App = window.App || {};
  window.App.views = window.App.views || {};

  // ---- Closure-State (Datum/Filter überleben Re-Renders) -------------------
  var calDate = null;                 // 'YYYY-MM-DD' für Kalender
  var bookingFilter = { date: "", rampId: "", status: "" };

  // ---- kleine Helfer -------------------------------------------------------
  function h(esc, s) { return esc(s == null ? "" : s); }

  function shiftDate(iso, days) {
    var d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + days);
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function jaNein(b) { return b ? "Ja" : "Nein"; }

  // Aktionsbuttons für eine Buchung im Status 'bestaetigt'
  function bookingRowActions(esc, b) {
    if (b.status !== "bestaetigt") return '<span class="muted">–</span>';
    return (
      '<button class="btn btn--ghost btn--sm" data-action="done" data-id="' + h(esc, b.id) + '">Erledigt</button> ' +
      '<button class="btn btn--ghost btn--sm" data-action="noshow" data-id="' + h(esc, b.id) + '">No-Show</button> ' +
      '<button class="btn btn--danger btn--sm" data-action="cancel" data-id="' + h(esc, b.id) + '">Stornieren</button>'
    );
  }

  // Zentrale Behandlung der Buchungs-Aktionen (für Tabellen)
  function handleBookingAction(action, id, ctx) {
    var store = ctx.store, ui = ctx.ui;
    if (action === "done") {
      store.setBookingStatus(id, "erledigt");
      ui.toast("Buchung als erledigt markiert.", "success");
      ctx.refresh();
    } else if (action === "noshow") {
      store.setBookingStatus(id, "no_show");
      ui.toast("Buchung als No-Show markiert.", "info");
      ctx.refresh();
    } else if (action === "cancel") {
      ui.confirm("Diese Buchung wirklich stornieren?", { okLabel: "Stornieren", danger: true })
        .then(function (ok) {
          if (!ok) return;
          store.cancelBooking(id);
          ui.toast("Buchung storniert.", "success");
          ctx.refresh();
        });
    }
  }

  // ==========================================================================
  // ROUTE: uebersicht
  // ==========================================================================
  function renderUebersicht(root, ctx) {
    var store = ctx.store, esc = ctx.ui.escapeHtml;
    var date = store.today();
    var k = store.kpisForDate(date);

    var kpiHtml =
      '<div class="kpi-grid">' +
        kpiCard("Buchungen heute", k.bookings) +
        kpiCard("Auslastung heute", Math.round((k.utilization || 0) * 100) + "%") +
        kpiCard("No-Shows", k.noShows) +
        kpiCard("Anstehend", k.upcoming) +
      "</div>";

    function kpiCard(label, value) {
      return '<div class="kpi"><div class="kpi__value">' + h(esc, value) +
        '</div><div class="kpi__label">' + h(esc, label) + "</div></div>";
    }

    // Heutiger Ablauf: nur bestaetigt/erledigt, sortiert (listBookings ist sortiert)
    var todays = store.listBookings({ date: date }).filter(function (b) {
      return b.status === "bestaetigt" || b.status === "erledigt";
    });

    var tableHtml;
    if (!todays.length) {
      tableHtml = '<div class="empty">Heute sind keine bestätigten Buchungen geplant.</div>';
    } else {
      var rows = todays.map(function (b) {
        var ramp = store.getRamp(b.rampId);
        return "<tr>" +
          "<td>" + h(esc, b.start) + "–" + h(esc, b.end) + "</td>" +
          "<td>" + h(esc, ramp ? ramp.name : b.rampId) + "</td>" +
          "<td>" + h(esc, b.supplierName) + "</td>" +
          "<td>" + h(esc, b.orderRef) + "</td>" +
          "<td>" + ctx.ui.statusBadge(b.status) + "</td>" +
          "</tr>";
      }).join("");
      tableHtml =
        '<table class="table"><thead><tr>' +
          "<th>Zeit</th><th>Rampe</th><th>Lieferant</th><th>Bestell-Nr.</th><th>Status</th>" +
        "</tr></thead><tbody>" + rows + "</tbody></table>";
    }

    root.innerHTML =
      '<div class="card"><div class="card__title">Übersicht</div>' +
        '<div class="card__sub">' + h(esc, ctx.ui.fmtDateLong(date)) + "</div>" +
        '<div class="card__body">' + kpiHtml + "</div>" +
      "</div>" +
      '<div class="card"><div class="card__title">Heutiger Ablauf</div>' +
        '<div class="card__body">' + tableHtml + "</div>" +
      "</div>";

    // Delegation für künftige Aktionen (aktuell keine in dieser Tabelle)
  }

  // ==========================================================================
  // ROUTE: kalender
  // ==========================================================================
  function renderKalender(root, ctx) {
    var store = ctx.store, esc = ctx.ui.escapeHtml;
    if (!calDate) calDate = store.today();
    var date = calDate;

    var ramps = store.listRamps(true);

    var navHtml =
      '<div class="date-nav">' +
        '<button class="btn btn--ghost btn--sm" data-cal="prev">‹ Zurück</button>' +
        '<button class="btn btn--ghost btn--sm" data-cal="today">Heute</button>' +
        '<button class="btn btn--ghost btn--sm" data-cal="next">Weiter ›</button>' +
        '<input class="input" type="date" data-cal="date" value="' + h(esc, date) + '">' +
        '<span class="pill">' + h(esc, ctx.ui.fmtDateLong(date)) + "</span>" +
      "</div>";

    var boardHtml;
    if (!ramps.length) {
      boardHtml = '<div class="empty">Keine aktiven Rampen vorhanden. Legen Sie unter „Rampen“ eine an.</div>';
    } else {
      boardHtml = '<div class="board">' + ramps.map(function (ramp) {
        var slots = store.getDaySlots(ramp.id, date);
        var cells;
        if (!slots.length) {
          cells = '<div class="empty">Keine Zeitfenster.</div>';
        } else {
          cells = slots.map(function (s) {
            return cellHtml(esc, ramp, s);
          }).join("");
        }
        return '<div class="board__col">' +
          '<div class="board__colhead">' + h(esc, ramp.name) +
            '<div class="muted">' + h(esc, ramp.openFrom) + "–" + h(esc, ramp.openTo) + "</div>" +
          "</div>" +
          '<div class="board__cells">' + cells + "</div>" +
        "</div>";
      }).join("") + "</div>";
    }

    root.innerHTML =
      '<div class="card"><div class="card__title">Buchungskalender</div>' +
        '<div class="card__body">' + navHtml + "</div>" +
      "</div>" + boardHtml;

    // ---- Events: Datum-Navigation -----------------------------------------
    // WICHTIG: Delegation nur EINMAL pro root-Element verdrahten. Diese Funktion
    // re-rendert sich bei Navigation selbst (renderKalender(root,ctx)), wodurch
    // sonst bei jedem Re-Render ein weiterer Listener auf demselben root hängen
    // bliebe (mehrfaches Feuern -> mehrere Modals). Handler lesen den Live-Stand
    // aus der Closure-Variable calDate (nicht das beim Anhängen gefangene date).
    if (root.dataset.calWired !== "1") {
      root.dataset.calWired = "1";
      root.addEventListener("click", function (e) {
        var navBtn = e.target.closest("[data-cal]");
        if (navBtn) {
          var what = navBtn.getAttribute("data-cal");
          if (what === "prev") { calDate = shiftDate(calDate, -1); renderKalender(root, ctx); return; }
          if (what === "today") { calDate = store.today(); renderKalender(root, ctx); return; }
          if (what === "next") { calDate = shiftDate(calDate, 1); renderKalender(root, ctx); return; }
        }
        var cell = e.target.closest(".board__cell");
        if (cell) { openCellModal(cell, calDate, ctx); }
      });
      root.addEventListener("change", function (e) {
        var dateInput = e.target.closest('[data-cal="date"]');
        if (dateInput && dateInput.value) { calDate = dateInput.value; renderKalender(root, ctx); }
      });
    }
  }

  function cellHtml(esc, ramp, s) {
    var meta;
    if (s.status === "belegt") {
      var first = s.bookings[0] || {};
      if (s.capacity > 1) {
        meta = h(esc, s.booked) + "/" + h(esc, s.capacity) + " · " + h(esc, first.supplierName);
      } else {
        meta = h(esc, first.supplierName) +
          (first.orderRef ? ' · <span class="muted">' + h(esc, first.orderRef) + "</span>" : "");
      }
    } else if (s.status === "gesperrt") {
      meta = "Gesperrt" + (s.block && s.block.reason ? " · " + h(esc, s.block.reason) : "");
    } else if (s.status === "vergangen") {
      meta = "Vergangen";
    } else {
      meta = "Frei";
    }

    return '<div class="board__cell is-' + h(esc, s.status) + '" ' +
        'data-start="' + h(esc, s.start) + '" data-end="' + h(esc, s.end) + '" ' +
        'data-ramp="' + h(esc, ramp.id) + '">' +
        '<div class="slot__time">' + h(esc, s.start) + "</div>" +
        '<div class="slot__meta">' + meta + "</div>" +
      "</div>";
  }

  function openCellModal(cell, date, ctx) {
    var store = ctx.store, ui = ctx.ui, esc = ui.escapeHtml;
    var rampId = cell.getAttribute("data-ramp");
    var start = cell.getAttribute("data-start");
    var end = cell.getAttribute("data-end");

    // Frischen Slot-Zustand holen (Daten könnten sich geändert haben)
    var slots = store.getDaySlots(rampId, date);
    var slot = slots.find(function (s) { return s.start === start; });
    if (!slot) return;
    var ramp = store.getRamp(rampId);
    var rampName = ramp ? ramp.name : rampId;
    var title = (ramp ? ramp.name : "Zeitfenster") + " · " + ui.fmtDate(date) + " · " + start + "–" + end;

    if (slot.status === "belegt") {
      var b = slot.bookings[0];
      if (!b) { ctx.refresh(); return; }
      var extra = "";
      if (slot.bookings.length > 1) {
        extra = '<p class="muted">+' + (slot.bookings.length - 1) +
          " weitere Buchung(en) in diesem Zeitfenster.</p>";
      }
      var body =
        '<div class="field"><span class="label">Lieferant</span><div>' + h(esc, b.supplierName) + "</div></div>" +
        '<div class="field"><span class="label">Bestell-Nr.</span><div>' + h(esc, b.orderRef) + "</div></div>" +
        '<div class="field"><span class="label">Menge</span><div>' + h(esc, b.qty) + "</div></div>" +
        '<div class="field"><span class="label">Notiz</span><div>' + (b.notes ? h(esc, b.notes) : '<span class="muted">–</span>') + "</div></div>" +
        extra;

      ui.modal({
        title: title,
        body: body,
        actions: [
          { label: "Als erledigt markieren", kind: "primary", onClick: function (close) {
              store.setBookingStatus(b.id, "erledigt");
              close(); ui.toast("Buchung als erledigt markiert.", "success"); ctx.refresh();
          } },
          { label: "No-Show", kind: "danger", onClick: function (close) {
              store.setBookingStatus(b.id, "no_show");
              close(); ui.toast("Buchung als No-Show markiert.", "info"); ctx.refresh();
          } },
          { label: "Stornieren", kind: "danger", onClick: function (close) {
              store.cancelBooking(b.id);
              close(); ui.toast("Buchung storniert.", "success"); ctx.refresh();
          } }
        ]
      });
      return;
    }

    if (slot.status === "frei") {
      var m = ui.modal({
        title: title,
        body:
          "<p>Dieses Zeitfenster ist frei. Sie können es für Wartung o. Ä. sperren.</p>" +
          '<div class="field"><label class="label" for="block-reason">Grund der Sperrung</label>' +
          '<input class="input" id="block-reason" type="text" placeholder="z. B. Wartung, Inventur"></div>',
        actions: [
          { label: "Slot sperren", kind: "primary", onClick: function (close) {
              var inp = m.el.querySelector("#block-reason");
              var reason = inp ? inp.value.trim() : "";
              store.addBlock(rampId, date, start, end, reason);
              close(); ui.toast("Zeitfenster gesperrt.", "success"); ctx.refresh();
          } }
        ]
      });
      return;
    }

    if (slot.status === "gesperrt") {
      var block = slot.block;
      ui.modal({
        title: title,
        body:
          "<p>Dieses Zeitfenster ist gesperrt.</p>" +
          '<div class="field"><span class="label">Grund</span><div>' +
            (block && block.reason ? h(esc, block.reason) : '<span class="muted">Kein Grund angegeben</span>') +
          "</div></div>",
        actions: [
          { label: "Entsperren", kind: "primary", onClick: function (close) {
              if (block) store.removeBlock(block.id);
              close(); ui.toast("Zeitfenster entsperrt.", "success"); ctx.refresh();
          } }
        ]
      });
      return;
    }

    // vergangen -> nur Info
    void rampName;
    ui.modal({
      title: title,
      body: "<p>Dieses Zeitfenster liegt in der Vergangenheit." +
        (slot.bookings && slot.bookings.length
          ? " Es war für <b>" + h(esc, slot.bookings[0].supplierName) + "</b> gebucht." : "") +
        "</p>",
      actions: [{ label: "Schließen", kind: "ghost", onClick: function (close) { close(); } }]
    });
  }

  // ==========================================================================
  // ROUTE: rampen
  // ==========================================================================
  function renderRampen(root, ctx) {
    var store = ctx.store, esc = ctx.ui.escapeHtml;
    var ramps = store.listRamps();

    var tableHtml;
    if (!ramps.length) {
      tableHtml = '<div class="empty">Noch keine Rampen angelegt.</div>';
    } else {
      var rows = ramps.map(function (r) {
        return "<tr>" +
          "<td>" + h(esc, r.name) + "</td>" +
          "<td>" + h(esc, r.openFrom) + "–" + h(esc, r.openTo) + "</td>" +
          "<td>" + h(esc, r.slotMinutes) + "</td>" +
          "<td>" + h(esc, r.capacity) + "</td>" +
          "<td>" + h(esc, jaNein(r.active)) + "</td>" +
          "<td>" +
            '<button class="btn btn--ghost btn--sm" data-action="edit" data-id="' + h(esc, r.id) + '">Bearbeiten</button> ' +
            '<button class="btn btn--danger btn--sm" data-action="delete" data-id="' + h(esc, r.id) + '">Löschen</button>' +
          "</td>" +
          "</tr>";
      }).join("");
      tableHtml =
        '<table class="table"><thead><tr>' +
          "<th>Name</th><th>Öffnungszeiten</th><th>Slotdauer (min)</th><th>Kapazität</th><th>Aktiv</th><th></th>" +
        "</tr></thead><tbody>" + rows + "</tbody></table>";
    }

    root.innerHTML =
      '<div class="card">' +
        '<div class="toolbar"><div class="card__title">Rampen</div><div class="spacer"></div>' +
          '<button class="btn btn--primary" data-action="new">+ Neue Rampe</button>' +
        "</div>" +
        '<div class="card__body">' + tableHtml + "</div>" +
      "</div>";

    root.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-action]");
      if (!btn) return;
      var action = btn.getAttribute("data-action");
      if (action === "new") {
        openRampForm(null, ctx);
      } else if (action === "edit") {
        openRampForm(store.getRamp(btn.getAttribute("data-id")), ctx);
      } else if (action === "delete") {
        var r = store.getRamp(btn.getAttribute("data-id"));
        if (!r) return;
        ctx.ui.confirm("Rampe „" + r.name + "“ löschen? Dies löscht auch zugehörige Buchungen.",
          { okLabel: "Löschen", danger: true })
          .then(function (ok) {
            if (!ok) return;
            store.deleteRamp(r.id);
            ctx.ui.toast("Rampe gelöscht.", "success");
            ctx.refresh();
          });
      }
    });
  }

  function openRampForm(ramp, ctx) {
    var store = ctx.store, ui = ctx.ui, esc = ui.escapeHtml;
    var isEdit = !!ramp;
    var r = ramp || { name: "", openFrom: "06:00", openTo: "18:00", slotMinutes: 30, capacity: 1, active: true };

    var body =
      '<div class="field"><label class="label" for="rf-name">Name</label>' +
        '<input class="input" id="rf-name" type="text" value="' + h(esc, r.name) + '" placeholder="z. B. Rampe 4 – Wareneingang"></div>' +
      '<div class="form-row">' +
        '<div class="field"><label class="label" for="rf-from">Öffnet (von)</label>' +
          '<input class="input" id="rf-from" type="time" value="' + h(esc, r.openFrom) + '"></div>' +
        '<div class="field"><label class="label" for="rf-to">Schließt (bis)</label>' +
          '<input class="input" id="rf-to" type="time" value="' + h(esc, r.openTo) + '"></div>' +
      "</div>" +
      '<div class="form-row">' +
        '<div class="field"><label class="label" for="rf-slot">Slotdauer (min)</label>' +
          '<input class="input" id="rf-slot" type="number" min="5" step="5" value="' + h(esc, r.slotMinutes) + '"></div>' +
        '<div class="field"><label class="label" for="rf-cap">Kapazität</label>' +
          '<input class="input" id="rf-cap" type="number" min="1" step="1" value="' + h(esc, r.capacity) + '"></div>' +
      "</div>" +
      '<label class="checkbox"><input id="rf-active" type="checkbox"' + (r.active ? " checked" : "") + "> Aktiv</label>";

    var m = ui.modal({
      title: isEdit ? "Rampe bearbeiten" : "Neue Rampe",
      body: body,
      actions: [
        { label: "Abbrechen", kind: "ghost", onClick: function (close) { close(); } },
        { label: "Speichern", kind: "primary", onClick: function (close) {
            var el = m.el;
            var name = el.querySelector("#rf-name").value.trim();
            var from = el.querySelector("#rf-from").value;
            var to = el.querySelector("#rf-to").value;
            var slot = parseInt(el.querySelector("#rf-slot").value, 10);
            var cap = parseInt(el.querySelector("#rf-cap").value, 10);
            var active = el.querySelector("#rf-active").checked;

            if (!name) { ui.toast("Bitte einen Namen angeben.", "error"); return; }
            if (!from || !to) { ui.toast("Bitte Öffnungszeiten angeben.", "error"); return; }
            if (store._toMin(to) <= store._toMin(from)) { ui.toast("„Bis“ muss nach „von“ liegen.", "error"); return; }
            if (!slot || slot < 1) { ui.toast("Slotdauer muss größer als 0 sein.", "error"); return; }
            if (!cap || cap < 1) { ui.toast("Kapazität muss mindestens 1 sein.", "error"); return; }

            var data = { name: name, openFrom: from, openTo: to, slotMinutes: slot, capacity: cap, active: active };
            if (isEdit) {
              store.updateRamp(r.id, data);
              ui.toast("Rampe gespeichert.", "success");
            } else {
              store.createRamp(data);
              ui.toast("Rampe angelegt.", "success");
            }
            close();
            ctx.refresh();
        } }
      ]
    });
  }

  // ==========================================================================
  // ROUTE: buchungen
  // ==========================================================================
  function renderBuchungen(root, ctx) {
    var store = ctx.store, esc = ctx.ui.escapeHtml;
    var ramps = store.listRamps();

    var STATUS_OPTS = [
      { v: "", l: "Alle" },
      { v: "bestaetigt", l: "Bestätigt" },
      { v: "storniert", l: "Storniert" },
      { v: "no_show", l: "No-Show" },
      { v: "erledigt", l: "Erledigt" }
    ];

    var rampOpts = '<option value="">Alle</option>' + ramps.map(function (r) {
      return '<option value="' + h(esc, r.id) + '"' + (bookingFilter.rampId === r.id ? " selected" : "") + ">" +
        h(esc, r.name) + "</option>";
    }).join("");

    var statusOpts = STATUS_OPTS.map(function (o) {
      return '<option value="' + h(esc, o.v) + '"' + (bookingFilter.status === o.v ? " selected" : "") + ">" +
        h(esc, o.l) + "</option>";
    }).join("");

    var toolbar =
      '<div class="toolbar">' +
        '<div class="field"><label class="label" for="f-date">Datum</label>' +
          '<input class="input" id="f-date" type="date" value="' + h(esc, bookingFilter.date) + '"></div>' +
        '<div class="field"><label class="label" for="f-ramp">Rampe</label>' +
          '<select class="select" id="f-ramp">' + rampOpts + "</select></div>" +
        '<div class="field"><label class="label" for="f-status">Status</label>' +
          '<select class="select" id="f-status">' + statusOpts + "</select></div>" +
        '<div class="spacer"></div>' +
        '<button class="btn btn--ghost btn--sm" data-action="clear">Filter zurücksetzen</button>' +
      "</div>";

    // Filter zusammenbauen (leere Werte weglassen)
    var filter = {};
    if (bookingFilter.date) filter.date = bookingFilter.date;
    if (bookingFilter.rampId) filter.rampId = bookingFilter.rampId;
    if (bookingFilter.status) filter.status = bookingFilter.status;

    var list = store.listBookings(filter);

    var tableHtml;
    if (!list.length) {
      tableHtml = '<div class="empty">Keine Buchungen für die aktuelle Auswahl.</div>';
    } else {
      var rows = list.map(function (b) {
        var ramp = store.getRamp(b.rampId);
        return "<tr>" +
          "<td>" + h(esc, ctx.ui.fmtDate(b.date)) + "</td>" +
          "<td>" + h(esc, b.start) + "–" + h(esc, b.end) + "</td>" +
          "<td>" + h(esc, ramp ? ramp.name : b.rampId) + "</td>" +
          "<td>" + h(esc, b.supplierName) + "</td>" +
          "<td>" + h(esc, b.orderRef) + "</td>" +
          "<td>" + h(esc, b.qty) + "</td>" +
          "<td>" + ctx.ui.statusBadge(b.status) + "</td>" +
          "<td>" + bookingRowActions(esc, b) + "</td>" +
          "</tr>";
      }).join("");
      tableHtml =
        '<table class="table"><thead><tr>' +
          "<th>Datum</th><th>Zeit</th><th>Rampe</th><th>Lieferant</th><th>Bestell-Nr.</th><th>Menge</th><th>Status</th><th></th>" +
        "</tr></thead><tbody>" + rows + "</tbody></table>";
    }

    root.innerHTML =
      '<div class="card"><div class="card__title">Buchungen</div>' +
        '<div class="card__body">' + toolbar + "</div>" +
      "</div>" +
      '<div class="card"><div class="card__body">' + tableHtml + "</div></div>";

    // ---- Events ------------------------------------------------------------
    // WICHTIG: Delegation nur EINMAL pro root verdrahten (diese Funktion
    // re-rendert sich bei Filteränderung selbst). Werte werden live aus dem DOM
    // gelesen, da die Felder bei jedem Re-Render neu erzeugt werden.
    if (root.dataset.bkWired !== "1") {
      root.dataset.bkWired = "1";

      root.addEventListener("change", function (e) {
        var field = e.target.closest("#f-date, #f-ramp, #f-status");
        if (!field) return;
        var elDate = root.querySelector("#f-date");
        var elRamp = root.querySelector("#f-ramp");
        var elStatus = root.querySelector("#f-status");
        bookingFilter.date = elDate ? (elDate.value || "") : "";
        bookingFilter.rampId = elRamp ? (elRamp.value || "") : "";
        bookingFilter.status = elStatus ? (elStatus.value || "") : "";
        renderBuchungen(root, ctx);
      });

      root.addEventListener("click", function (e) {
        var clearBtn = e.target.closest('[data-action="clear"]');
        if (clearBtn) {
          bookingFilter = { date: "", rampId: "", status: "" };
          renderBuchungen(root, ctx);
          return;
        }
        var btn = e.target.closest("[data-action][data-id]");
        if (!btn) return;
        handleBookingAction(btn.getAttribute("data-action"), btn.getAttribute("data-id"), ctx);
      });
    }
  }

  // ==========================================================================
  // ROUTE: lieferanten
  // ==========================================================================
  function renderLieferanten(root, ctx) {
    var store = ctx.store, esc = ctx.ui.escapeHtml;
    var users = store.listUsers("lieferant");

    var tableHtml;
    if (!users.length) {
      tableHtml = '<div class="empty">Noch keine Lieferanten registriert.</div>';
    } else {
      var rows = users.map(function (u) {
        var count = store.listBookings({ supplierId: u.id }).length;
        return "<tr>" +
          "<td>" + h(esc, u.company) + "</td>" +
          "<td>" + (u.name ? h(esc, u.name) : '<span class="muted">–</span>') + "</td>" +
          "<td>" + h(esc, u.email) + "</td>" +
          "<td>" + h(esc, count) + "</td>" +
          "</tr>";
      }).join("");
      tableHtml =
        '<table class="table"><thead><tr>' +
          "<th>Firma</th><th>Ansprechpartner</th><th>E-Mail</th><th>Buchungen</th>" +
        "</tr></thead><tbody>" + rows + "</tbody></table>";
    }

    root.innerHTML =
      '<div class="card"><div class="card__title">Lieferanten</div>' +
        '<div class="card__body">' + tableHtml + "</div>" +
      "</div>";
  }

  // ==========================================================================
  // Dispatcher
  // ==========================================================================
  window.App.views.admin = {
    render: function (route, root, ctx) {
      switch (route) {
        case "uebersicht": renderUebersicht(root, ctx); break;
        case "kalender": renderKalender(root, ctx); break;
        case "rampen": renderRampen(root, ctx); break;
        case "buchungen": renderBuchungen(root, ctx); break;
        case "lieferanten": renderLieferanten(root, ctx); break;
        default:
          root.innerHTML = '<div class="empty">Unbekannte Ansicht.</div>';
      }
    }
  };
})();
