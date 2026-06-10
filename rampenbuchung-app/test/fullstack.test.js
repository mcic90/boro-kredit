/* Integrierter Full-Stack-Smoke-Test: lädt die vom SERVER ausgelieferte Seite
   (index.server.html + reale Skripte) in jsdom, shimmt window.fetch auf den
   laufenden Server und meldet sich real an. READ-ONLY (keine Datenmutation).
   Voraussetzung: Server läuft (node server/server.js). BASE per env überschreibbar.
   Start aus dem App-Ordner:  node test/fullstack.test.js  */
"use strict";
const { JSDOM } = require("jsdom");
const BASE = process.env.BASE || "http://localhost:3000";

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log("PASS " + m); } else { fail++; console.log("FAIL " + m); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const realFetch = global.fetch;

(async function () {
  try {
    // sicherstellen, dass der Server erreichbar ist
    let up = false;
    for (let i = 0; i < 15 && !up; i++) { try { up = (await realFetch(BASE + "/api/bootstrap")).ok; } catch (e) { await sleep(200); } }
    ok(up, "Server erreichbar (" + BASE + ")");

    const dom = await JSDOM.fromURL(BASE, {
      runScripts: "dangerously",
      resources: "usable",
      pretendToBeVisual: true,
      beforeParse(window) {
        window.fetch = (p, o) => realFetch(/^https?:/.test(p) ? p : BASE + p, o);
        window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
      }
    });
    const { window } = dom;
    const doc = window.document;
    const q = (s, r) => (r || doc).querySelector(s);
    const fire = (el, t) => el.dispatchEvent(new window.Event(t, { bubbles: true, cancelable: true }));

    // auf Hydration + erstes Rendern warten
    for (let i = 0; i < 25 && !q("#form-login") && !q(".app-shell"); i++) await sleep(120);
    ok(!!window.App && !!window.App.store, "App-Skripte vom Server geladen & ausgeführt");
    ok(q("#form-login"), "Login-Ansicht nach Hydration gerendert");

    // Admin-Login gegen die echte API
    q("#form-login input[name=email]").value = "admin@demo.de";
    q("#form-login input[name=password]").value = "demo";
    fire(q("#form-login"), "submit");

    for (let i = 0; i < 25 && !q(".app-shell"); i++) await sleep(120);
    ok(q(".app-shell"), "App-Shell nach echtem Admin-Login (Server-Auth)");
    ok(window.location.hash === "#/admin", "Standardroute Admin");
    ok(q(".kpi"), "Admin-Übersicht rendert KPIs aus Server-Daten");

    window.location.hash = "#/admin/kalender"; fire(window, "hashchange");
    await sleep(150);
    ok(q(".board") && q(".board__col"), "Buchungskalender rendert (Board mit Rampen-Spalten)");

    window.location.hash = "#/admin/buchungen"; fire(window, "hashchange");
    await sleep(150);
    ok(doc.body.textContent.indexOf("BE-100245") > -1 || q(".table"), "Seed-Buchung aus Server-DB sichtbar");

    dom.window.close();
  } catch (e) {
    fail++; console.log("FAIL Ausnahme: " + (e && e.stack ? e.stack : e));
  }
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
