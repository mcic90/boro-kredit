-- ============================================================================
--  RampSlot — Supabase / PostgreSQL Backend-Schema
-- ----------------------------------------------------------------------------
--  Zweck: Spiegelt das App-Datenmodell aus js/store.js 1:1 als relationale
--         Datenbank wider. Optionaler Umstieg von localStorage -> Supabase.
--
--  Ausführung: Supabase Dashboard -> SQL Editor -> komplett einfügen und
--              "Run". Skript ist idempotent genug für eine frische DB
--              (verwendet IF NOT EXISTS / CREATE OR REPLACE wo sinnvoll).
--
--  Mapping store.js (camelCase) -> SQL (snake_case):
--    openFrom    -> open_from        slotMinutes -> slot_minutes
--    openTo      -> open_to          rampId      -> ramp_id
--    date        -> booking_date / block_date    start -> start_time
--    end         -> end_time         supplierId  -> supplier_id
--    supplierName-> supplier_name    orderRef    -> order_ref
--    createdAt   -> created_at        type        -> type
--
--  Status-Werte (identisch zur App):
--    bookings.status: 'bestaetigt' | 'storniert' | 'no_show' | 'erledigt'
--    profiles.type:   'lieferant'  | 'admin'
-- ============================================================================


-- ----------------------------------------------------------------------------
--  0) Erweiterungen
-- ----------------------------------------------------------------------------
--  gen_random_uuid() stammt aus pgcrypto. In Supabase ist die Extension i.d.R.
--  bereits aktiviert; der folgende Aufruf stellt das sicher.
create extension if not exists pgcrypto;


-- ----------------------------------------------------------------------------
--  1) profiles — Lieferanten- & Admin-Stammdaten
--     Verknüpft 1:1 mit Supabase Auth (auth.users). Die App-Rolle steckt in
--     "type" und ist die einzige Rollenquelle (RLS, is_admin()).
--     Entspricht state.users aus store.js — ABER: kein Passwort-Feld!
--     Passwörter/Sessions verwaltet Supabase Auth, nicht diese Tabelle.
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid        primary key references auth.users (id) on delete cascade,
  type       text        not null default 'lieferant'
                         check (type in ('lieferant', 'admin')),
  company    text        not null default '',
  name       text        not null default '',
  email      text        not null default '',
  created_at timestamptz not null default now()
);

comment on table  public.profiles      is 'App-Profil je Auth-Benutzer (Rolle, Firma). Rollenquelle für RLS.';
comment on column public.profiles.id   is 'Gleich auth.users.id (kein eigenes gen_random_uuid()).';
comment on column public.profiles.type is 'App-Rolle: lieferant | admin.';


-- ----------------------------------------------------------------------------
--  2) ramps — Laderampen / Tore
--     Entspricht state.ramps.
-- ----------------------------------------------------------------------------
create table if not exists public.ramps (
  id           uuid        primary key default gen_random_uuid(),
  name         text        not null default 'Neue Rampe',
  open_from    time        not null default '06:00',   -- store.js: openFrom 'HH:MM'
  open_to      time        not null default '18:00',   -- store.js: openTo   'HH:MM'
  slot_minutes int         not null default 30,        -- Slot-Länge in Minuten
  capacity     int         not null default 1,         -- parallele Buchungen je Slot
  active       boolean      not null default true,
  created_at   timestamptz not null default now(),
  constraint ramps_slot_minutes_pos check (slot_minutes > 0),
  constraint ramps_capacity_pos     check (capacity     > 0),
  constraint ramps_open_order       check (open_to > open_from)
);

comment on table public.ramps is 'Laderampen mit Öffnungszeiten, Slot-Länge und Kapazität.';

-- Index: häufige Filterung auf aktive Rampen (listRamps(activeOnly=true)).
create index if not exists ramps_active_idx on public.ramps (active);


-- ----------------------------------------------------------------------------
--  3) bookings — Zeitfenster-Buchungen
--     Entspricht state.bookings.
--     supplier_id zeigt auf profiles(id); supplier_name/email/carrier werden
--     als Snapshot mitgeführt (wie in store.js), damit historische Buchungen
--     stabil bleiben, auch wenn sich das Profil später ändert.
-- ----------------------------------------------------------------------------
create table if not exists public.bookings (
  id            uuid        primary key default gen_random_uuid(),
  ramp_id       uuid        not null references public.ramps (id) on delete cascade,
  booking_date  date        not null,                  -- store.js: date 'YYYY-MM-DD'
  start_time    time        not null,                  -- store.js: start 'HH:MM'
  end_time      time        not null,                  -- store.js: end   'HH:MM'
  supplier_id   uuid        references public.profiles (id) on delete set null,
  supplier_name text        not null default '',
  email         text        not null default '',
  carrier       text        not null default '',
  order_ref     text        not null,                  -- Pflicht (store.createBooking)
  qty           int         not null default 0,
  notes         text        not null default '',
  status        text        not null default 'bestaetigt'
                            check (status in ('bestaetigt', 'storniert', 'no_show', 'erledigt')),
  created_at    timestamptz not null default now(),
  constraint bookings_time_order check (end_time > start_time)
);

comment on table  public.bookings        is 'Zeitfensterbuchungen je Rampe/Datum/Startzeit.';
comment on column public.bookings.status is 'bestaetigt | storniert | no_show | erledigt. Nur bestaetigt/erledigt zählen für Kapazität.';

-- Indizes laut Vorgabe + typische Query-Pfade.
create index if not exists bookings_ramp_date_idx on public.bookings (ramp_id, booking_date); -- getDaySlots / Kalender
create index if not exists bookings_supplier_idx  on public.bookings (supplier_id);           -- listBookingsBySupplier


-- ----------------------------------------------------------------------------
--  4) blocks — Sperrzeiten (Wartung, Pause, …)
--     Entspricht state.blocks.
-- ----------------------------------------------------------------------------
create table if not exists public.blocks (
  id          uuid        primary key default gen_random_uuid(),
  ramp_id     uuid        not null references public.ramps (id) on delete cascade,
  block_date  date        not null,                    -- store.js: date 'YYYY-MM-DD'
  start_time  time        not null,                    -- store.js: start 'HH:MM'
  end_time    time        not null,                    -- store.js: end   'HH:MM'
  reason      text        not null default '',
  created_at  timestamptz not null default now(),
  constraint blocks_time_order check (end_time > start_time)
);

comment on table public.blocks is 'Manuelle Sperrzeiten je Rampe; überlagern freie Slots als "gesperrt".';

create index if not exists blocks_ramp_date_idx on public.blocks (ramp_id, block_date);


-- ============================================================================
--  5) DOPPELBUCHUNGSSCHUTZ
-- ----------------------------------------------------------------------------
--  Es werden ZWEI komplementäre Mechanismen umgesetzt:
--
--  (A) Partial UNIQUE INDEX  — schneller, deklarativer Hard-Stop für den
--      häufigsten Fall capacity = 1 (genau eine aktive Buchung je Slot).
--      Greift auf Datenbank-Ebene unabhängig von der App.
--
--  (B) BEFORE INSERT/UPDATE TRIGGER — die allgemeine, kapazitätsbewusste
--      Lösung (auch für capacity > 1). Zählt bestehende aktive Buchungen am
--      selben ramp_id/booking_date/start_time und wirft EXCEPTION, sobald die
--      Kapazität der Rampe erreicht ist. Spiegelt activeBookingsAt()
--      + Kapazitätsprüfung aus store.createBooking().
--
--  "Aktiv" = status IN ('bestaetigt','erledigt) — exakt wie store.js.
--  Damit blockieren stornierte / no_show-Buchungen den Slot NICHT.
-- ============================================================================

-- (A) Partial UNIQUE INDEX für Kapazität 1:
--     Verhindert >1 aktive Buchung auf demselben Slot. Bezieht sich nur auf
--     aktive Buchungen (WHERE-Klausel), damit stornierte Slots wieder frei sind.
--     Hinweis: deckt nur capacity=1 ab; capacity>1 regelt der Trigger (B).
create unique index if not exists bookings_no_double_cap1_idx
  on public.bookings (ramp_id, booking_date, start_time)
  where status in ('bestaetigt', 'erledigt');
comment on index public.bookings_no_double_cap1_idx is
  'Hard-Stop gegen Doppelbuchung bei capacity=1 (nur aktive Buchungen). Kapazitaet>1 prueft der Trigger.';

-- (B) Kapazitätsbewusster Trigger (allgemein, auch capacity > 1).
create or replace function public.enforce_booking_capacity()
returns trigger
language plpgsql
as $$
declare
  v_capacity int;
  v_active   int;
begin
  -- Nur aktive Buchungen können den Slot belegen. Inaktive (storniert/no_show)
  -- müssen nicht gegen die Kapazität geprüft werden.
  if new.status not in ('bestaetigt', 'erledigt') then
    return new;
  end if;

  -- Kapazität der Zielrampe holen (FOR SHARE: stabil gegen parallele Inserts
  -- auf dieselbe Rampe innerhalb konkurrierender Transaktionen).
  select capacity into v_capacity
  from public.ramps
  where id = new.ramp_id
  for share;

  if v_capacity is null then
    raise exception 'Rampe % existiert nicht.', new.ramp_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Bereits aktive Buchungen im selben Slot zählen (sich selbst beim UPDATE
  -- ausnehmen).
  select count(*) into v_active
  from public.bookings b
  where b.ramp_id      = new.ramp_id
    and b.booking_date = new.booking_date
    and b.start_time   = new.start_time
    and b.status in ('bestaetigt', 'erledigt')
    and b.id is distinct from new.id;

  if v_active >= v_capacity then
    raise exception
      'Zeitfenster % % an Rampe % ist bereits ausgebucht (Kapazitaet %).',
      new.booking_date, new.start_time, new.ramp_id, v_capacity
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
comment on function public.enforce_booking_capacity() is
  'BEFORE INSERT/UPDATE: prueft aktive Buchungen je Slot gegen ramps.capacity, sonst EXCEPTION.';

drop trigger if exists bookings_capacity_guard on public.bookings;
create trigger bookings_capacity_guard
  before insert or update on public.bookings
  for each row
  execute function public.enforce_booking_capacity();


-- ============================================================================
--  6) HILFSFUNKTION is_admin()  (SECURITY DEFINER)
-- ----------------------------------------------------------------------------
--  Prüft, ob der aktuell eingeloggte Auth-Benutzer (auth.uid()) ein Admin ist.
--  SECURITY DEFINER, damit der Lookup in profiles funktioniert, OHNE dass die
--  RLS-Policies auf profiles eine Rekursion auslösen (Policy auf profiles würde
--  sonst is_admin() aufrufen, das wiederum profiles liest -> Endlosschleife).
--  search_path fix gesetzt (Sicherheit gegen Hijacking).
-- ============================================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.type = 'admin'
  );
$$;
comment on function public.is_admin() is
  'TRUE, wenn auth.uid() ein Profil mit type=admin hat. SECURITY DEFINER -> keine RLS-Rekursion.';

-- Ausführungsrecht für eingeloggte Nutzer (Supabase-Rollen).
grant execute on function public.is_admin() to authenticated;


-- ============================================================================
--  7) ROW LEVEL SECURITY + POLICIES
-- ----------------------------------------------------------------------------
--  Grundsatz:
--    * ramps / blocks : jeder eingeloggte Nutzer darf LESEN; nur Admins
--                       dürfen schreiben.
--    * bookings       : Lieferant verwaltet die EIGENEN (supplier_id =
--                       auth.uid()); Admin darf alles.
--    * profiles       : jeder sieht/ändert sein eigenes Profil; Admin alles.
--  RLS gilt für die Rolle "authenticated" (eingeloggte App-Nutzer). Die
--  anon-Rolle erhält bewusst keine Policy -> ohne Login kein Zugriff.
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.ramps    enable row level security;
alter table public.bookings enable row level security;
alter table public.blocks   enable row level security;

-- ---- profiles --------------------------------------------------------------
-- SELECT: eigenes Profil ODER Admin sieht alle.
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- INSERT: ein Nutzer darf genau sein eigenes Profil anlegen (id = auth.uid()).
--         (Optional automatisierbar per Trigger on auth.users — siehe unten.)
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

-- UPDATE: eigenes Profil ODER Admin. WITH CHECK verhindert Fremd-Umschreiben.
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- DELETE: nur Admin (z. B. Lieferanten-Verwaltung).
create policy profiles_delete on public.profiles
  for delete to authenticated
  using (public.is_admin());

-- ---- ramps -----------------------------------------------------------------
-- SELECT: alle eingeloggten (Lieferanten brauchen Rampen für die Buchung).
create policy ramps_select on public.ramps
  for select to authenticated
  using (true);

-- INSERT/UPDATE/DELETE: nur Admin. Drei getrennte Policies für Klarheit.
create policy ramps_insert on public.ramps
  for insert to authenticated
  with check (public.is_admin());

create policy ramps_update on public.ramps
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy ramps_delete on public.ramps
  for delete to authenticated
  using (public.is_admin());

-- ---- blocks ----------------------------------------------------------------
-- SELECT: alle eingeloggten (Lieferant muss gesperrte Slots erkennen).
create policy blocks_select on public.blocks
  for select to authenticated
  using (true);

-- INSERT/UPDATE/DELETE: nur Admin.
create policy blocks_insert on public.blocks
  for insert to authenticated
  with check (public.is_admin());

create policy blocks_update on public.blocks
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy blocks_delete on public.blocks
  for delete to authenticated
  using (public.is_admin());

-- ---- bookings --------------------------------------------------------------
-- SELECT: eigene Buchungen (supplier_id = auth.uid()) ODER Admin sieht alle.
create policy bookings_select on public.bookings
  for select to authenticated
  using (supplier_id = auth.uid() or public.is_admin());

-- INSERT: Lieferant darf nur AUF DEN EIGENEN Namen buchen (supplier_id =
--         auth.uid()); Admin darf für beliebige Lieferanten buchen.
create policy bookings_insert on public.bookings
  for insert to authenticated
  with check (supplier_id = auth.uid() or public.is_admin());

-- UPDATE: eigene Buchung (z. B. stornieren) ODER Admin (Status setzen).
create policy bookings_update on public.bookings
  for update to authenticated
  using (supplier_id = auth.uid() or public.is_admin())
  with check (supplier_id = auth.uid() or public.is_admin());

-- DELETE: in der App wird storniert statt gelöscht. Hartes Löschen nur Admin.
create policy bookings_delete on public.bookings
  for delete to authenticated
  using (public.is_admin());


-- ============================================================================
--  8) OPTIONAL: Profil automatisch bei Registrierung anlegen
-- ----------------------------------------------------------------------------
--  Komfort: Sobald ein Nutzer über Supabase Auth registriert wird, wird
--  automatisch ein 'lieferant'-Profil erzeugt. Firma/Name kommen aus den
--  bei signUp übergebenen user_metadata (options.data.{company,name}).
--  Admins werden danach manuell hochgestuft (siehe Seed unten).
--
--  -> Auskommentiert lassen, falls Profile lieber explizit per INSERT aus der
--     App angelegt werden sollen.
-- ----------------------------------------------------------------------------
-- create or replace function public.handle_new_user()
-- returns trigger
-- language plpgsql
-- security definer
-- set search_path = public
-- as $$
-- begin
--   insert into public.profiles (id, type, company, name, email)
--   values (
--     new.id,
--     'lieferant',
--     coalesce(new.raw_user_meta_data ->> 'company', ''),
--     coalesce(new.raw_user_meta_data ->> 'name', ''),
--     coalesce(new.email, '')
--   )
--   on conflict (id) do nothing;
--   return new;
-- end;
-- $$;
--
-- drop trigger if exists on_auth_user_created on auth.users;
-- create trigger on_auth_user_created
--   after insert on auth.users
--   for each row execute function public.handle_new_user();


-- ============================================================================
--  9) OPTIONAL: Seed der Demo-Rampen (entspricht seed() in store.js)
-- ----------------------------------------------------------------------------
--  Die drei Demo-Rampen aus der localStorage-Variante. Buchungen/Profile
--  werden NICHT geseedet, da Profile an echte auth.users hängen müssen — diese
--  legt man über Supabase Auth an (Dashboard -> Authentication -> Add user)
--  und stuft danach den Admin per UPDATE hoch (Beispiel ganz unten).
--
--  -> Zum Aktivieren den folgenden INSERT-Block einkommentieren.
-- ----------------------------------------------------------------------------
-- insert into public.ramps (name, open_from, open_to, slot_minutes, capacity, active) values
--   ('Rampe 1 – Wareneingang',       '06:00', '18:00', 30, 1, true),
--   ('Rampe 2 – Warenausgang',       '07:00', '17:00', 60, 1, true),
--   ('Rampe 3 – Stückgut/Express',   '06:00', '14:00', 30, 2, true);

--  Admin hochstufen, NACHDEM der Benutzer über Supabase Auth angelegt wurde
--  (E-Mail anpassen):
-- update public.profiles
--   set type = 'admin', company = 'Werk Karlsruhe', name = 'Hof-Administration'
--   where email = 'admin@demo.de';

-- ============================================================================
--  Ende des Schemas.
-- ============================================================================
