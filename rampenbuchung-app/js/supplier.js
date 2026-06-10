/* ============================================================================
   supplier.js — Lieferanten-Views (Agent)
   Exporte: window.App.views.supplier
   Routen: 'buchen' (Zeitfenster buchen), 'meine' (Meine Buchungen)
   ctx = { user, store, ui, navigate(hash), refresh() }
   ========================================================================== */
(function () {
  "use strict";
  window.App = window.App || {};
  window.App.views = window.App.views || {};

  // ---- kleine Helfer -------------------------------------------------------
  function esc(ctx, s) { return ctx.ui.escapeHtml(s); }

  // Liegt (date,end) in der Vergangenheit? (spiegelt store.isPast wider,
  // ohne auf private Funktionen angewiesen zu sein)
  function isPast(store, date, end) {
    var t = store.today();
    if (date < t) return true;
    if (date === t && hmToMin(end) <= hmToMin(store.nowHM())) return true;
    return false;
  }
  function hmToMin(hm) {
    var p = String(hm || "0:0").split(":");
    return (+p[0]) * 60 + (+p[1]);
  }

  // ==========================================================================
  // ROUTE 'buchen'
  // ==========================================================================
  function renderBuchen(root, ctx) {
    var store = ctx.store;
    var ramps = store.listRamps(true);

    // Kopf
    var html =
      '<div class="card">' +
        '<div class="card__title">Zeitfenster buchen</div>' +
        '<div class="card__sub">Wähle eine Rampe und ein Datum und buche ein freies Zeitfenster für deine Anlieferung oder Abholung. Die Buchung ist verbindlich; eine Bestätigung erhältst du per E-Mail (Demo).</div>' +
        '<div class="card__body">';

    if (!ramps.length) {
      html +=
        '<div class="empty">Aktuell sind keine Rampen freigeschaltet. Bitte wende dich an den Verlader.</div>' +
        "</div></div>";
      root.innerHTML = html;
      return;
    }

    var today = store.today();

    // Toolbar: Rampe + Datum
    var rampOptions = ramps.map(function (r) {
      return '<option value="' + esc(ctx, r.id) + '">' + esc(ctx, r.name) + "</option>";
    }).join("");

    html +=
      '<div class="toolbar">' +
        '<div class="field">' +
          '<label class="label" for="sup-ramp">Rampe</label>' +
          '<select class="select" id="sup-ramp">' + rampOptions + "</select>" +
        "</div>" +
        '<div class="field">' +
          '<label class="label" for="sup-date">Datum</label>' +
          '<input class="input" type="date" id="sup-date" value="' + esc(ctx, today) + '" min="' + esc(ctx, today) + '">' +
        "</div>" +
      "</div>" +
      '<div id="sup-slots"></div>' +
      "</div></div>";

    root.innerHTML = html;

    var selRamp = root.querySelector("#sup-ramp");
    var inpDate = root.querySelector("#sup-date");
    var slotHost = root.querySelector("#sup-slots");

    function renderSlots() {
      slotHost.innerHTML = buildSlotListHtml(ctx, selRamp.value, inpDate.value);
    }

    selRamp.addEventListener("change", renderSlots);
    inpDate.addEventListener("change", function () {
      // Schutz: kein Datum vor heute zulassen
      if (inpDate.value && inpDate.value < today) inpDate.value = today;
      renderSlots();
    });

    // Klick auf freien Slot -> Buchungsformular
    slotHost.addEventListener("click", function (e) {
      var el = e.target.closest(".slot--frei");
      if (!el || !slotHost.contains(el)) return;
      var start = el.getAttribute("data-start");
      if (!start) return;
      openBookingModal(ctx, selRamp.value, inpDate.value, start);
    });

    renderSlots();
  }

  function buildSlotListHtml(ctx, rampId, date) {
    var store = ctx.store;
    var ramp = store.getRamp(rampId);
    if (!ramp) return '<div class="empty">Rampe nicht gefunden.</div>';

    var slots = store.getDaySlots(rampId, date);
    if (!slots.length) return '<div class="empty">Für diesen Tag sind keine Zeitfenster verfügbar.</div>';

    var multi = ramp.capacity > 1;

    var items = slots.map(function (s) {
      var meta = "";
      if (s.status === "frei") {
        meta = multi ? "frei: " + (s.capacity - s.booked) + " von " + s.capacity : "frei";
      } else if (s.status === "belegt") {
        meta = "ausgebucht";
      } else if (s.status === "gesperrt") {
        var reason = s.block && s.block.reason ? s.block.reason : "gesperrt";
        meta = ctx.ui.escapeHtml(reason);
      } else if (s.status === "vergangen") {
        meta = "vorbei";
      }

      var attrs = "";
      if (s.status === "frei") {
        attrs = ' data-start="' + ctx.ui.escapeHtml(s.start) + '" role="button" tabindex="0"';
      }

      return '<div class="slot slot--' + s.status + '"' + attrs + ">" +
          '<span class="slot__time">' + ctx.ui.escapeHtml(s.start) + "–" + ctx.ui.escapeHtml(s.end) + "</span>" +
          '<span class="slot__meta">' + meta + "</span>" +
        "</div>";
    }).join("");

    return '<div class="slot-list">' + items + "</div>";
  }

  function openBookingModal(ctx, rampId, date, start) {
    var store = ctx.store;
    var ui = ctx.ui;
    var user = ctx.user;
    var ramp = store.getRamp(rampId);
    if (!ramp) { ui.toast("Rampe nicht gefunden.", "error"); return; }

    // berechnetes Ende für die Anzeige
    var end = "";
    if (store._toHM && store._toMin) end = store._toHM(store._toMin(start) + ramp.slotMinutes);

    var company = user && user.company ? user.company : "";

    var body =
      '<div class="help" style="margin-bottom:10px">' +
        ui.escapeHtml(ramp.name) + " · " + ui.escapeHtml(ui.fmtDateLong(date)) +
        " · " + ui.escapeHtml(start) + (end ? "–" + ui.escapeHtml(end) : "") +
      "</div>" +
      '<form id="sup-book-form">' +
        '<div class="field">' +
          '<label class="label" for="bk-ref">Bestell-/Referenznummer *</label>' +
          '<input class="input" id="bk-ref" name="orderRef" required placeholder="z. B. BE-100245">' +
        "</div>" +
        '<div class="field">' +
          '<label class="label" for="bk-carrier">Spedition / Carrier</label>' +
          '<input class="input" id="bk-carrier" name="carrier" value="' + ui.escapeHtml(company) + '" placeholder="Name der Spedition">' +
        "</div>" +
        '<div class="field">' +
          '<label class="label" for="bk-qty">Menge (optional)</label>' +
          '<input class="input" id="bk-qty" name="qty" type="number" min="0" step="1" placeholder="z. B. Paletten/Stück">' +
        "</div>" +
        '<div class="field">' +
          '<label class="label" for="bk-notes">Notiz (optional)</label>' +
          '<textarea class="textarea" id="bk-notes" name="notes" rows="3" placeholder="z. B. Kühlware, Avis-Nr., Besonderheiten"></textarea>' +
        "</div>" +
      "</form>";

    function submit(close) {
      var form = m.el.querySelector("#sup-book-form");
      if (!form) return;
      var refEl = form.querySelector("#bk-ref");
      var carrierEl = form.querySelector("#bk-carrier");
      var qtyEl = form.querySelector("#bk-qty");
      var notesEl = form.querySelector("#bk-notes");
      var orderRef = ((refEl && refEl.value) || "").trim();
      if (!orderRef) {
        ui.toast("Bitte eine Bestell-/Referenznummer angeben.", "error");
        if (refEl) refEl.focus();
        return;
      }
      var res = store.createBooking({
        rampId: rampId,
        date: date,
        start: start,
        supplierId: user ? user.id : null,
        supplierName: company,
        email: user ? user.email : "",
        carrier: ((carrierEl && carrierEl.value) || "").trim() || company,
        orderRef: orderRef,
        qty: qtyEl ? qtyEl.value : "",
        notes: ((notesEl && notesEl.value) || "").trim()
      });
      if (!res.ok) {
        ui.toast(res.error || "Buchung nicht möglich.", "error");
        return;
      }
      close();
      ui.toast("Zeitfenster gebucht – Bestätigung per E-Mail (Demo).", "success");
      ctx.refresh();
    }

    var m = ui.modal({
      title: "Zeitfenster verbindlich buchen",
      body: body,
      actions: [
        { label: "Abbrechen", kind: "ghost", onClick: function (c) { c(); } },
        { label: "Verbindlich buchen", kind: "primary", onClick: function (c) { submit(c); } }
      ]
    });

    // Enter im Formular = buchen
    var formEl = m.el.querySelector("#sup-book-form");
    if (formEl) {
      formEl.addEventListener("submit", function (e) {
        e.preventDefault();
        submit(m.close);
      });
    }
  }

  // ==========================================================================
  // ROUTE 'meine'
  // ==========================================================================
  function renderMeine(root, ctx) {
    var store = ctx.store;
    var ui = ctx.ui;
    var user = ctx.user;

    var bookings = user ? store.listBookingsBySupplier(user.id) : [];

    var html =
      '<div class="card">' +
        '<div class="card__title">Meine Buchungen</div>' +
        '<div class="card__sub">Übersicht aller von dir gebuchten Zeitfenster.</div>' +
        '<div class="card__body">';

    if (!bookings.length) {
      html +=
        '<div class="empty">' +
          "<p>Noch keine Buchungen.</p>" +
          '<button class="btn btn--primary" id="sup-go-buchen">Jetzt Zeitfenster buchen</button>' +
        "</div>" +
        "</div></div>";
      root.innerHTML = html;
      var btn = root.querySelector("#sup-go-buchen");
      if (btn) btn.addEventListener("click", function () { ctx.navigate("#/buchen"); });
      return;
    }

    var rows = bookings.map(function (b) {
      var ramp = store.getRamp(b.rampId);
      var rampName = ramp ? ramp.name : "—";
      var qty = b.qty ? b.qty : "—";

      // Aktion nur für zukünftige, bestätigte Buchungen
      var actionHtml = "—";
      if (b.status === "bestaetigt" && !isPast(store, b.date, b.end)) {
        actionHtml = '<button class="btn btn--danger btn--sm" data-cancel="' + ui.escapeHtml(b.id) + '">Stornieren</button>';
      }

      return "<tr>" +
          "<td>" + ui.escapeHtml(ui.fmtDateLong(b.date)) + "</td>" +
          "<td>" + ui.escapeHtml(b.start) + "–" + ui.escapeHtml(b.end) + "</td>" +
          "<td>" + ui.escapeHtml(rampName) + "</td>" +
          "<td>" + ui.escapeHtml(b.orderRef) + "</td>" +
          "<td>" + ui.escapeHtml(qty) + "</td>" +
          "<td>" + ui.statusBadge(b.status) + "</td>" +
          "<td>" + actionHtml + "</td>" +
        "</tr>";
    }).join("");

    html +=
      '<table class="table">' +
        "<thead><tr>" +
          "<th>Datum</th><th>Zeit</th><th>Rampe</th><th>Bestell-Nr.</th><th>Menge</th><th>Status</th><th></th>" +
        "</tr></thead>" +
        "<tbody>" + rows + "</tbody>" +
      "</table>" +
      "</div></div>";

    root.innerHTML = html;

    // Storno-Delegation
    root.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-cancel]");
      if (!btn || !root.contains(btn)) return;
      var id = btn.getAttribute("data-cancel");
      var b = store.getBooking(id);
      if (!b) return;
      ui.confirm(
        "Diese Buchung wirklich stornieren? Das Zeitfenster wird wieder freigegeben.",
        { okLabel: "Stornieren", danger: true }
      ).then(function (ok) {
        if (!ok) return;
        if (store.cancelBooking(id)) {
          ui.toast("Buchung storniert.", "success");
          ctx.refresh();
        } else {
          ui.toast("Stornierung nicht möglich.", "error");
        }
      });
    });
  }

  // ==========================================================================
  // Render-Dispatcher
  // ==========================================================================
  window.App.views.supplier = {
    render: function (route, root, ctx) {
      if (route === "meine") {
        renderMeine(root, ctx);
      } else {
        // Standard: 'buchen'
        renderBuchen(root, ctx);
      }
    }
  };
})();
