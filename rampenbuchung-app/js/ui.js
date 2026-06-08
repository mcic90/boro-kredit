/* ============================================================================
   ui.js — Komponenten & Helfer (Backbone)
   Exporte: window.App.ui
   ========================================================================== */
(function () {
  "use strict";
  window.App = window.App || {};

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  var WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  function fmtDate(iso) {
    if (!iso) return "";
    var p = iso.split("-");
    return p[2] + "." + p[1] + "." + p[0];
  }
  function fmtDateLong(iso) {
    if (!iso) return "";
    var d = new Date(iso + "T00:00:00");
    return WD[d.getDay()] + ", " + fmtDate(iso);
  }

  var STATUS_LABEL = {
    bestaetigt: "Bestätigt", storniert: "Storniert",
    no_show: "No-Show", erledigt: "Erledigt", gesperrt: "Gesperrt"
  };
  function statusBadge(status) {
    var label = STATUS_LABEL[status] || status;
    return '<span class="badge badge--' + status + '">' + escapeHtml(label) + "</span>";
  }

  // ---- Toast ---------------------------------------------------------------
  function ensureToastHost() {
    var host = document.getElementById("toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "toast-host";
      document.body.appendChild(host);
    }
    return host;
  }
  function toast(message, type, ms) {
    type = type || "info"; ms = ms || 3200;
    var host = ensureToastHost();
    var t = document.createElement("div");
    t.className = "toast toast--" + type;
    t.textContent = message;
    host.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("is-in"); });
    setTimeout(function () {
      t.classList.remove("is-in");
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 250);
    }, ms);
  }

  // ---- Modal ---------------------------------------------------------------
  function modal(opts) {
    opts = opts || {};
    var backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";

    var actionsHtml = (opts.actions || []).map(function (a, i) {
      var kind = a.kind || "ghost";
      return '<button class="btn btn--' + kind + '" data-act="' + i + '">' + escapeHtml(a.label) + "</button>";
    }).join("");

    backdrop.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
        '<div class="modal__head"><h3>' + escapeHtml(opts.title || "") + "</h3>" +
          '<button class="modal__close" data-close aria-label="Schließen">&times;</button></div>' +
        '<div class="modal__body">' + (opts.body || "") + "</div>" +
        (actionsHtml ? '<div class="modal__foot">' + actionsHtml + "</div>" : "") +
      "</div>";

    function close() {
      document.removeEventListener("keydown", onKey);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      if (typeof opts.onClose === "function") opts.onClose();
    }
    function onKey(e) { if (e.key === "Escape") close(); }

    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop || e.target.hasAttribute("data-close")) { close(); return; }
      var btn = e.target.closest("[data-act]");
      if (btn) {
        var a = opts.actions[+btn.getAttribute("data-act")];
        if (a && typeof a.onClick === "function") a.onClick(close);
      }
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(backdrop);

    // Fokus auf erstes Eingabefeld
    var firstInput = backdrop.querySelector("input,select,textarea");
    if (firstInput) firstInput.focus();

    return { close: close, el: backdrop };
  }

  // ---- Confirm (Promise) ---------------------------------------------------
  function confirmDialog(message, o) {
    o = o || {};
    return new Promise(function (resolve) {
      var m = modal({
        title: o.title || "Bitte bestätigen",
        body: '<p>' + escapeHtml(message) + "</p>",
        actions: [
          { label: "Abbrechen", kind: "ghost", onClick: function (c) { c(); resolve(false); } },
          { label: o.okLabel || "OK", kind: o.danger ? "danger" : "primary", onClick: function (c) { c(); resolve(true); } }
        ],
        onClose: function () { resolve(false); }
      });
      void m;
    });
  }

  window.App.ui = {
    escapeHtml: escapeHtml, fmtDate: fmtDate, fmtDateLong: fmtDateLong,
    statusBadge: statusBadge, toast: toast, modal: modal, confirm: confirmDialog
  };
})();
