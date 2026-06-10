/* ============================================================================
   app.server.js — Bootstrap, Router, App-Shell, Login (Full-Stack-Variante)
   Wie app.js, aber: start() wartet auf App.store.init() (Promise), und die
   Login-/Register-Handler behandeln App.auth.* als Promise.
   Lädt zuletzt. Erwartet: App.store, App.ui, App.auth, App.views.*
   ========================================================================== */
(function () {
  "use strict";
  var App = window.App;

  var SUPPLIER_NAV = [
    { hash: "#/buchen", route: "buchen", label: "Zeitfenster buchen" },
    { hash: "#/meine-buchungen", route: "meine", label: "Meine Buchungen" }
  ];
  var ADMIN_NAV = [
    { hash: "#/admin", route: "uebersicht", label: "Übersicht" },
    { hash: "#/admin/kalender", route: "kalender", label: "Buchungskalender" },
    { hash: "#/admin/rampen", route: "rampen", label: "Rampen" },
    { hash: "#/admin/buchungen", route: "buchungen", label: "Buchungen" },
    { hash: "#/admin/lieferanten", route: "lieferanten", label: "Lieferanten" }
  ];

  function root() { return document.getElementById("app"); }

  // ---- Login ---------------------------------------------------------------
  function renderLogin() {
    var ui = App.ui;
    root().innerHTML =
      '<div class="auth-wrap">' +
        '<div class="auth-card card">' +
          '<div class="brand"><span class="brand-mark">R</span> RampSlot</div>' +
          '<p class="card__sub">Rampen-Zeitfenster online buchen</p>' +
          '<div class="auth-tabs">' +
            '<button data-tab="login" class="is-active">Anmelden</button>' +
            '<button data-tab="register">Registrieren</button>' +
          "</div>" +
          '<form id="form-login">' +
            '<div class="field"><label class="label">E-Mail</label><input class="input" type="email" name="email" required placeholder="name@firma.de"></div>' +
            '<div class="field"><label class="label">Passwort</label><input class="input" type="password" name="password" required placeholder="••••••"></div>' +
            '<button class="btn btn--primary btn--block" type="submit">Anmelden</button>' +
          "</form>" +
          '<form id="form-register" hidden>' +
            '<div class="field"><label class="label">Firma</label><input class="input" name="company" required placeholder="Muster Spedition GmbH"></div>' +
            '<div class="field"><label class="label">Ansprechpartner</label><input class="input" name="name" placeholder="Vor- und Nachname"></div>' +
            '<div class="field"><label class="label">E-Mail</label><input class="input" type="email" name="email" required placeholder="name@firma.de"></div>' +
            '<div class="field"><label class="label">Passwort</label><input class="input" type="password" name="password" required placeholder="mind. 4 Zeichen"></div>' +
            '<button class="btn btn--primary btn--block" type="submit">Konto erstellen &amp; anmelden</button>' +
          "</form>" +
          '<div class="auth-demo">Demo-Zugänge — Admin: <b>admin@demo.de</b> · Lieferant: <b>lieferant@demo.de</b> · Passwort: <b>demo</b></div>' +
        "</div>" +
      "</div>";

    var elLogin = document.getElementById("form-login");
    var elReg = document.getElementById("form-register");
    var tabs = root().querySelectorAll(".auth-tabs button");
    tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        tabs.forEach(function (x) { x.classList.remove("is-active"); });
        t.classList.add("is-active");
        var isLogin = t.getAttribute("data-tab") === "login";
        elLogin.hidden = !isLogin; elReg.hidden = isLogin;
      });
    });

    elLogin.addEventListener("submit", function (e) {
      e.preventDefault();
      var d = new FormData(elLogin);
      Promise.resolve(App.auth.login(d.get("email").trim(), d.get("password"))).then(function (res) {
        if (!res.ok) { ui.toast(res.error, "error"); return; }
        ui.toast("Willkommen, " + (res.user.name || res.user.company) + "!", "success");
        gotoDefault(res.user);
      });
    });

    elReg.addEventListener("submit", function (e) {
      e.preventDefault();
      var d = new FormData(elReg);
      if (String(d.get("password")).length < 4) { ui.toast("Passwort muss mind. 4 Zeichen haben.", "error"); return; }
      Promise.resolve(App.auth.register({
        company: d.get("company").trim(), name: (d.get("name") || "").trim(),
        email: d.get("email").trim(), password: d.get("password")
      })).then(function (res) {
        if (!res.ok) { ui.toast(res.error, "error"); return; }
        ui.toast("Konto erstellt. Willkommen!", "success");
        gotoDefault(res.user);
      });
    });
  }

  // ---- Shell ---------------------------------------------------------------
  function renderShell(user, nav, activeRoute) {
    var ui = App.ui;
    var roleLabel = user.type === "admin" ? "Verlader / Admin" : "Lieferant";
    var navHtml = nav.map(function (n) {
      return '<a class="nav-link' + (n.route === activeRoute ? " is-active" : "") + '" href="' + n.hash + '">' +
        ui.escapeHtml(n.label) + "</a>";
    }).join("");

    root().innerHTML =
      '<div class="app-shell">' +
        '<header class="topbar">' +
          '<div class="brand"><span class="brand-mark">R</span> RampSlot</div>' +
          '<div class="topbar-actions">' +
            '<span class="user-chip"><b>' + ui.escapeHtml(user.company) + "</b> · " + roleLabel + "</span>" +
            '<button class="btn btn--ghost btn--sm" id="btn-reset">Demo&nbsp;zurücksetzen</button>' +
            '<button class="btn btn--ghost btn--sm" id="btn-logout">Abmelden</button>' +
          "</div>" +
        "</header>" +
        '<div class="app-body">' +
          '<aside class="sidebar"><nav class="nav">' + navHtml + "</nav></aside>" +
          '<main class="main"><section class="view" id="view"></section></main>' +
        "</div>" +
      "</div>";

    document.getElementById("btn-logout").addEventListener("click", function () {
      App.auth.logout(); location.hash = "#/login"; route();
    });
    document.getElementById("btn-reset").addEventListener("click", function () {
      App.ui.confirm("Demodaten wirklich zurücksetzen? Alle Buchungen gehen verloren.", { okLabel: "Zurücksetzen", danger: true })
        .then(function (ok) { if (ok) { App.store.reset(); location.hash = "#/login"; route(); App.ui.toast("Demodaten zurückgesetzt.", "success"); } });
    });

    return document.getElementById("view");
  }

  // ---- Routing -------------------------------------------------------------
  function gotoDefault(user) {
    location.hash = user.type === "admin" ? "#/admin" : "#/buchen";
    route();
  }

  function route() {
    var user = App.auth.current();
    var hash = location.hash || "";

    if (!user) { renderLogin(); return; }

    var nav = user.type === "admin" ? ADMIN_NAV : SUPPLIER_NAV;
    var match = nav.find(function (n) { return n.hash === hash; });

    // unbekannter/fremder Hash -> Standard der Rolle
    if (!match) {
      location.hash = user.type === "admin" ? "#/admin" : "#/buchen";
      return; // hashchange triggert route() erneut
    }
    var activeRoute = match.route;

    var viewEl = renderShell(user, nav, activeRoute);
    var ctx = {
      user: user, store: App.store, ui: App.ui,
      navigate: function (h) { location.hash = h; },
      refresh: function () { route(); }
    };

    try {
      if (user.type === "admin") App.views.admin.render(activeRoute, viewEl, ctx);
      else App.views.supplier.render(activeRoute, viewEl, ctx);
    } catch (err) {
      viewEl.innerHTML = '<div class="error-box">Fehler beim Laden der Ansicht: ' +
        App.ui.escapeHtml(err && err.message ? err.message : String(err)) + "</div>";
      if (window.console) console.error(err);
    }
  }

  // ---- Start ---------------------------------------------------------------
  function start() {
    Promise.resolve(App.store.init()).then(route);
    window.addEventListener("hashchange", route);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
