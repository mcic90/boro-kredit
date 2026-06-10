/* ============================================================================
   auth.js — Session / Login / Registrierung (Backbone, Demo-Auth)
   Exporte: window.App.auth
   Hinweis: Demo-Authentifizierung (Passwort im Klartext im localStorage).
   Für Produktion durch echtes Auth (z. B. Supabase Auth) ersetzen.
   ========================================================================== */
(function () {
  "use strict";
  window.App = window.App || {};
  var store = function () { return window.App.store; };

  function current() {
    var s = store().getState();
    if (!s || !s.session) return null;
    return store().getUser(s.session.userId) || null;
  }

  function login(email, password) {
    var u = store().getUserByEmail(email);
    if (!u) return { ok: false, error: "Kein Konto mit dieser E-Mail gefunden." };
    if (u.password !== password) return { ok: false, error: "Passwort ist nicht korrekt." };
    store().getState().session = { userId: u.id };
    store().save();
    return { ok: true, user: u };
  }

  function register(data) {
    if (!data.company || !data.email || !data.password) {
      return { ok: false, error: "Firma, E-Mail und Passwort sind erforderlich." };
    }
    if (store().getUserByEmail(data.email)) {
      return { ok: false, error: "Diese E-Mail ist bereits registriert." };
    }
    var u = store().createUser({
      type: "lieferant", company: data.company, name: data.name || "",
      email: data.email, password: data.password
    });
    store().getState().session = { userId: u.id };
    store().save();
    return { ok: true, user: u };
  }

  function logout() {
    store().getState().session = null;
    store().save();
  }

  window.App.auth = { current: current, login: login, register: register, logout: logout };
})();
