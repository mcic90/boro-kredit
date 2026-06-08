/* ============================================================================
   auth.api.js — Session / Login / Registrierung (Full-Stack-Variante)
   login/register async gegen /api/*; current()/logout() lokal über den Cache.
   Exporte: window.App.auth   (gleiche Signaturen wie auth.js)
   ========================================================================== */
(function () {
  "use strict";
  window.App = window.App || {};
  var store = function () { return window.App.store; };

  // SYNC: liefert den eingeloggten User aus Session/Cache (wie auth.js).
  function current() {
    var s = store().getState();
    if (!s || !s.session) return null;
    return store().getUser(s.session.userId) || null;
  }

  // Stellt sicher, dass der User im Cache liegt (Bootstrap liefert evtl. nicht alle).
  function mergeUser(user) {
    if (!user) return;
    var s = store().getState();
    var existing = store().getUser(user.id);
    if (existing) {
      Object.keys(user).forEach(function (k) { existing[k] = user[k]; });
    } else {
      s.users.push(user);
    }
  }

  // ASYNC: POST /api/login -> Promise<{ok:true,user} | {ok:false,error}>
  function login(email, password) {
    return fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: password })
    }).then(function (res) {
      return res.json().then(function (data) { return { res: res, data: data }; });
    }).then(function (r) {
      var data = r.data || {};
      if (!r.res.ok || data.ok === false || !data.user) {
        return { ok: false, error: data.error || "Anmeldung fehlgeschlagen." };
      }
      mergeUser(data.user);
      store().getState().session = { userId: data.user.id };
      return { ok: true, user: store().getUser(data.user.id) || data.user };
    }).catch(function (e) {
      if (window.console) console.error("login failed", e);
      return { ok: false, error: "Anmeldung fehlgeschlagen (Netzwerkfehler)." };
    });
  }

  // ASYNC: POST /api/register -> Promise<{ok:true,user} | {ok:false,error}>
  function register(data) {
    return fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: data.company, name: data.name || "",
        email: data.email, password: data.password
      })
    }).then(function (res) {
      return res.json().then(function (d) { return { res: res, data: d }; });
    }).then(function (r) {
      var d = r.data || {};
      if (!r.res.ok || d.ok === false || !d.user) {
        return { ok: false, error: d.error || "Registrierung fehlgeschlagen." };
      }
      mergeUser(d.user);
      store().getState().session = { userId: d.user.id };
      return { ok: true, user: store().getUser(d.user.id) || d.user };
    }).catch(function (e) {
      if (window.console) console.error("register failed", e);
      return { ok: false, error: "Registrierung fehlgeschlagen (Netzwerkfehler)." };
    });
  }

  // SYNC: lokale Session beenden.
  function logout() {
    store().getState().session = null;
  }

  window.App.auth = { current: current, login: login, register: register, logout: logout };
})();
