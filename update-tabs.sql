-- הזכרונות שלנו: לשוניות (חופשות, הופעות, מסעדות, עם הילדים + לשוניות שיוצרים בהמשך).
-- להריץ פעם אחת ב-Supabase (פרויקט Down-to-the-bone) → SQL Editor, אחרי update-sharing.sql.
-- כל מה שכבר הוזן נשאר בלשונית "חופשות".

alter table public.album_trips add column if not exists tab    text  not null default 'trips';
alter table public.album_trips add column if not exists rating int   not null default 0;
alter table public.album_trips add column if not exists url    text  not null default '';
alter table public.album_trips add column if not exists lists  jsonb not null default '{}'::jsonb;  -- רשימות נוספות (מנות, שירים, פעילויות…)
create index if not exists album_trips_tab on public.album_trips (user_id, tab);

create table if not exists public.album_tabs (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key        text not null,
  name       text not null,
  icon       text not null default '📁',
  noun       text not null default 'זיכרון',
  sections   jsonb not null default '[]'::jsonb,
  sort       int  not null default 0,
  created_at timestamptz not null default now(),
  unique (owner_id, key)
);
alter table public.album_tabs enable row level security;
drop policy if exists "album_tabs shared" on public.album_tabs;
create policy "album_tabs shared" on public.album_tabs
  for all using (public.album_can_access(owner_id::text)) with check (public.album_can_access(owner_id::text));

grant select on public.album_tabs to anon;
grant select, insert, update, delete on public.album_tabs to authenticated, service_role;
