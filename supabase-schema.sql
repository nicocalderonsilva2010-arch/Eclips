-- Ejecuta esto una vez en Supabase Dashboard > SQL Editor.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  banner_url text,
  banner_scale numeric default 1,
  banner_x integer default 50,
  banner_y integer default 50,
  updated_at timestamptz default now()
);

-- Campos que decoran el perfil y que podrán ver los friends aceptados.
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists social_handle text;
alter table public.profiles add column if not exists favorite_artists text;
alter table public.profiles add column if not exists gallery jsonb default '[]'::jsonb;
alter table public.profiles add column if not exists friend_code text unique;

-- Se crea antes de las políticas de perfiles porque estas consultan amistades.
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  check (user_id <> friend_id)
);

alter table public.profiles enable row level security;

drop policy if exists "Users can view their own Eclipse profile" on public.profiles;
drop policy if exists "Users can view their own or friends Eclipse profile" on public.profiles;
create policy "Users can view their own or friends Eclipse profile"
on public.profiles for select to authenticated
using (
  (select auth.uid()) = id
  or exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((user_id = (select auth.uid()) and friend_id = profiles.id)
        or (friend_id = (select auth.uid()) and user_id = profiles.id))
  )
);

drop policy if exists "Users can create their own Eclipse profile" on public.profiles;
create policy "Users can create their own Eclipse profile"
on public.profiles for insert to authenticated
with check ((select auth.uid()) = id);

-- Solicitudes de amistad: solo sus dos participantes pueden verlas.
create unique index if not exists friendships_unique_pair
on public.friendships (least(user_id, friend_id), greatest(user_id, friend_id));

alter table public.friendships enable row level security;
grant select, update, delete on public.friendships to authenticated;

drop policy if exists "Users can view their friendships" on public.friendships;
create policy "Users can view their friendships"
on public.friendships for select to authenticated
using ((select auth.uid()) in (user_id, friend_id));

drop policy if exists "Recipients can accept friendship requests" on public.friendships;
create policy "Recipients can accept friendship requests"
on public.friendships for update to authenticated
using ((select auth.uid()) = friend_id and status = 'pending')
with check ((select auth.uid()) = friend_id and status = 'accepted');

drop policy if exists "Users can remove their friendships" on public.friendships;
create policy "Users can remove their friendships"
on public.friendships for delete to authenticated
using ((select auth.uid()) in (user_id, friend_id));

-- Busca el código sin revelar correos y crea la solicitud de forma segura.
create or replace function public.send_friend_request(requested_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  request_id uuid;
begin
  select id into target_id from public.profiles
  where upper(friend_code) = upper(trim(requested_code));
  if target_id is null then raise exception 'No encontramos ese código de Eclipse'; end if;
  if target_id = auth.uid() then raise exception 'Ese es tu propio código'; end if;
  insert into public.friendships (user_id, friend_id)
  values (auth.uid(), target_id)
  returning id into request_id;
  return request_id;
exception when unique_violation then
  raise exception 'Ya existe una solicitud o amistad con esta persona';
end;
$$;

grant execute on function public.send_friend_request(text) to authenticated;

drop policy if exists "Users can update their own Eclipse profile" on public.profiles;
create policy "Users can update their own Eclipse profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);
