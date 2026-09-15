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
-- Estos tres campos los guarda el cliente al editar la foto. Sin ellos el
-- upsert completo falla y, en consecuencia, tampoco se guarda el código.
alter table public.profiles add column if not exists avatar_scale numeric default 1;
alter table public.profiles add column if not exists avatar_x integer default 50;
alter table public.profiles add column if not exists avatar_y integer default 50;

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

-- Seguimientos y búsqueda de personas. La búsqueda es una función segura:
-- devuelve solamente datos públicos de perfil, incluso con RLS activado.
create table if not exists public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

alter table public.follows enable row level security;
grant select, insert, delete on public.follows to authenticated;

drop policy if exists "Users can view follows" on public.follows;
create policy "Users can view follows" on public.follows for select to authenticated
using (true);
drop policy if exists "Users can follow from their own account" on public.follows;
create policy "Users can follow from their own account" on public.follows for insert to authenticated
with check ((select auth.uid()) = follower_id);
drop policy if exists "Users can unfollow from their own account" on public.follows;
create policy "Users can unfollow from their own account" on public.follows for delete to authenticated
using ((select auth.uid()) = follower_id);

create or replace function public.search_eclipse_people(search_term text)
returns table (
  id uuid,
  display_name text,
  avatar_url text,
  bio text,
  follower_count bigint,
  is_following boolean
)
language sql
security definer
set search_path = public
as $$
  select p.id,
         p.display_name,
         p.avatar_url,
         p.bio,
         (select count(*) from public.follows f where f.following_id = p.id) as follower_count,
         exists (
           select 1 from public.follows f
           where f.follower_id = auth.uid() and f.following_id = p.id
         ) as is_following
  from public.profiles p
  where p.id <> auth.uid()
    and coalesce(p.display_name, '') ilike '%' || trim(search_term) || '%'
  order by p.updated_at desc nulls last
  limit 30;
$$;

grant execute on function public.search_eclipse_people(text) to authenticated;

create or replace function public.get_my_eclipse_followers()
returns table (id uuid, display_name text, avatar_url text, bio text, favorite_artists text, banner_url text, gallery jsonb)
language sql security definer set search_path = public
as $$ select p.id, p.display_name, p.avatar_url, p.bio, p.favorite_artists, p.banner_url, p.gallery from public.follows f join public.profiles p on p.id = f.follower_id where f.following_id = auth.uid() order by f.created_at desc; $$;
grant execute on function public.get_my_eclipse_followers() to authenticated;

-- Se invoca únicamente después de reautenticar con correo y contraseña en la app.
-- El borrado de auth.users activa las cascadas de perfiles, friends y follows.
create or replace function public.delete_my_eclipse_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_eclipse_account() from public;
grant execute on function public.delete_my_eclipse_account() to authenticated;

drop policy if exists "Users can update their own Eclipse profile" on public.profiles;
create policy "Users can update their own Eclipse profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);
