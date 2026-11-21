-- אלבום החופשות: שיתוף האלבום (צפייה, יצירה ועריכה) לפי כתובת מייל + קישור לגוגל תמונות.
-- להריץ פעם אחת ב-Supabase (פרויקט Down-to-the-bone) → SQL Editor, אחרי schema.sql.

-- מי מקבל גישה לאלבום של מי
create table if not exists public.album_members (
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  email       text not null,
  owner_email text not null default '',
  created_at  timestamptz not null default now(),
  primary key (owner_id, email)
);
alter table public.album_members enable row level security;
grant select on public.album_members to anon;
grant select, insert, update, delete on public.album_members to authenticated, service_role;

-- האם המשתמש המחובר רשאי לגשת לאלבום של owner (הבעלים עצמו, או מייל שהבעלים שיתף איתו)
create or replace function public.album_can_access(p_owner text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_owner = auth.uid()::text
      or exists (select 1 from public.album_members m
                 where m.owner_id::text = p_owner
                   and lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
grant execute on function public.album_can_access(text) to authenticated;

drop policy if exists "album_members owner manages" on public.album_members;
create policy "album_members owner manages" on public.album_members
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "album_members see my invites" on public.album_members;
create policy "album_members see my invites" on public.album_members
  for select using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- חופשות: הבעלים ומי ששותף איתו
drop policy if exists "album_trips own rows" on public.album_trips;
drop policy if exists "album_trips shared" on public.album_trips;
create policy "album_trips shared" on public.album_trips
  for all using (public.album_can_access(user_id::text)) with check (public.album_can_access(user_id::text));

-- קישור לאלבום בגוגל תמונות
alter table public.album_trips add column if not exists gphotos text not null default '';

-- תמונות: אותה הרשאה, לפי התיקייה של בעל האלבום (<owner id>/...)
drop policy if exists "album photos read own"   on storage.objects;
drop policy if exists "album photos add own"    on storage.objects;
drop policy if exists "album photos change own" on storage.objects;
drop policy if exists "album photos delete own" on storage.objects;
drop policy if exists "album photos read"   on storage.objects;
drop policy if exists "album photos add"    on storage.objects;
drop policy if exists "album photos change" on storage.objects;
drop policy if exists "album photos delete" on storage.objects;

create policy "album photos read" on storage.objects for select to authenticated
  using (bucket_id = 'album-photos' and public.album_can_access((storage.foldername(name))[1]));
create policy "album photos add" on storage.objects for insert to authenticated
  with check (bucket_id = 'album-photos' and public.album_can_access((storage.foldername(name))[1]));
create policy "album photos change" on storage.objects for update to authenticated
  using (bucket_id = 'album-photos' and public.album_can_access((storage.foldername(name))[1]));
create policy "album photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'album-photos' and public.album_can_access((storage.foldername(name))[1]));
