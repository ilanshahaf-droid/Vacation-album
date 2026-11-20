-- אלבום החופשות: טבלה עם קידומת album_ כדי לא להתנגש בטבלאות של אפליקציות אחרות באותו פרויקט.
-- להריץ פעם אחת ב-Supabase (פרויקט Down-to-the-bone) → SQL Editor.

create table if not exists public.album_trips (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null default '',
  location    text not null default '',
  start_date  date,
  end_date    date,
  companions  text not null default '',
  summary     text not null default '',
  places      jsonb not null default '[]'::jsonb,
  restaurants jsonb not null default '[]'::jsonb,
  sites       jsonb not null default '[]'::jsonb,
  shows       jsonb not null default '[]'::jsonb,
  photos      jsonb not null default '[]'::jsonb,   -- [{path, caption}]
  cover       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists album_trips_user on public.album_trips (user_id, start_date desc);

alter table public.album_trips enable row level security;
drop policy if exists "album_trips own rows" on public.album_trips;
create policy "album_trips own rows" on public.album_trips
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- הרשאות Data API (נדרש לטבלאות חדשות מאז 30.10.2026)
grant select on public.album_trips to anon;
grant select, insert, update, delete on public.album_trips to authenticated, service_role;

-- תיקייה פרטית לתמונות (עד 10MB לקובץ)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('album-photos', 'album-photos', false, 10485760,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- כל משתמש ניגש רק לתיקייה שלו (<user id>/...)
drop policy if exists "album photos read own"   on storage.objects;
drop policy if exists "album photos add own"    on storage.objects;
drop policy if exists "album photos change own" on storage.objects;
drop policy if exists "album photos delete own" on storage.objects;

create policy "album photos read own" on storage.objects for select to authenticated
  using (bucket_id = 'album-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "album photos add own" on storage.objects for insert to authenticated
  with check (bucket_id = 'album-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "album photos change own" on storage.objects for update to authenticated
  using (bucket_id = 'album-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "album photos delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'album-photos' and (storage.foldername(name))[1] = auth.uid()::text);
