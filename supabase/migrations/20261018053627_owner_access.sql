-- Owner access is controlled in private tables; no password or password digest is stored.
-- Existing identities, memberships, QR tokens and credentials are preserved.
create table private.owner_access (
 restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
 user_id uuid not null unique,
 login_alias text unique check(login_alias is null or login_alias ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
 requires_password_change boolean not null default false,
 reset_pending boolean not null default false,
 session_not_before timestamptz,
 accepted_session_id uuid,
 generation uuid not null default gen_random_uuid(),
 pending_request_id uuid,
 updated_at timestamptz not null default now()
);
alter table private.owner_access enable row level security;
revoke all on private.owner_access from public,anon,authenticated;
grant all on private.owner_access to service_role;
insert into private.owner_access(restaurant_id,user_id)
 select restaurant_id,user_id from public.restaurant_memberships;

create table private.owner_access_requests (
 actor_id uuid not null references public.platform_admins(user_id),
 request_id uuid not null,
 restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 owner_id uuid not null,
 owner_email text not null,
 login_alias text,
 new_user boolean not null,
 state text not null check(state in ('reserved','auth_started','completed','failed')),
 lease_token uuid not null default gen_random_uuid(),
 lease_until timestamptz not null default clock_timestamp()+interval '2 minutes',
 error_code text,
 created_at timestamptz not null default now(),
 primary key(actor_id,request_id)
);
alter table private.owner_access_requests enable row level security;
revoke all on private.owner_access_requests from public,anon,authenticated;
grant all on private.owner_access_requests to service_role;
create index owner_access_requests_restaurant_idx on private.owner_access_requests(restaurant_id);

create function private.owner_session_allowed(p_require_changed boolean default true) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists (
  select 1 from private.owner_access a where a.user_id=(select auth.uid()) and (
   a.reset_pending or (p_require_changed and a.requires_password_change) or
   (a.session_not_before is not null and not exists (
    select 1 from auth.sessions s
    where s.id=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid
      and s.user_id=a.user_id and (s.created_at>=a.session_not_before or s.id=a.accepted_session_id)
   ))
  )
 );
$$;
revoke all on function private.owner_session_allowed(boolean) from public,anon;
grant execute on function private.owner_session_allowed(boolean) to authenticated,service_role;

create or replace function private.owns_restaurant(p_restaurant_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and (select private.owner_session_allowed()) and exists (
  select 1 from public.restaurant_memberships m
  where m.restaurant_id=p_restaurant_id and m.user_id=(select auth.uid()) and m.is_active
 );
$$;
create or replace function private.can_manage_restaurant(p_restaurant_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and (select private.owner_session_allowed()) and exists (
  select 1 from public.restaurant_memberships m join public.restaurants r on r.id=m.restaurant_id
  where m.restaurant_id=p_restaurant_id and m.user_id=(select auth.uid()) and m.is_active and r.status='active'
 );
$$;

-- Narrow authenticated RPC exposes only the caller's access state, never aliases or other accounts.
create function public.owner_session_state() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'valid', (select auth.uid()) is not null and private.owner_session_allowed(false),
  'requiresPasswordChange',coalesce(a.requires_password_change,false),
  'generation',a.generation)
 from (select (select auth.uid()) as user_id) u
 left join private.owner_access a on a.user_id=u.user_id;
$$;
revoke all on function public.owner_session_state() from public,anon;
grant execute on function public.owner_session_state() to authenticated;

-- Only the server can resolve aliases. No authenticated/public directory is exposed.
create function public.resolve_owner_login(p_alias text) returns text
language sql stable security invoker set search_path='' as $$
 select r.owner_email from private.owner_access a
 join public.restaurant_memberships m on m.restaurant_id=a.restaurant_id and m.user_id=a.user_id
 join public.restaurants r on r.id=a.restaurant_id
 where a.login_alias=p_alias and not exists(select 1 from public.platform_admins p where p.user_id=a.user_id);
$$;
create function public.owner_admin_state(p_restaurant_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('restaurantId',r.id,'email',r.owner_email,'userId',m.user_id,
  'alias',a.login_alias,'isActive',coalesce(m.is_active,false),
  'requiresPasswordChange',coalesce(a.requires_password_change,false),
  'operationPending',coalesce(a.reset_pending,false),'pendingRequestId',a.pending_request_id,'hasAccess',m.user_id is not null)
 from public.restaurants r
 left join public.restaurant_memberships m on m.restaurant_id=r.id
 left join private.owner_access a on a.restaurant_id=r.id
 where r.id=p_restaurant_id;
$$;

create function public.claim_owner_access(p_actor_id uuid,p_request_id uuid,p_restaurant_id uuid,p_alias text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a private.owner_access; q private.owner_access_requests; m public.restaurant_memberships; r public.restaurants; fresh boolean;
begin
 if not exists(select 1 from public.platform_admins where user_id=p_actor_id and is_active) then
  raise exception 'admin_required' using errcode='42501'; end if;
 if p_alias is not null and p_alias !~ '^[a-z0-9][a-z0-9._-]{2,31}$' then
  raise exception 'invalid_alias' using errcode='22023'; end if;
 select * into r from public.restaurants where id=p_restaurant_id for update;
 if not found then raise exception 'restaurant_missing' using errcode='P0002'; end if;
 select * into q from private.owner_access_requests where actor_id=p_actor_id and request_id=p_request_id for update;
 if found then
  if q.restaurant_id<>p_restaurant_id or q.login_alias is distinct from p_alias then
   return jsonb_build_object('state','mismatch'); end if;
  if q.state='completed' then return jsonb_build_object('state','completed'); end if;
  if q.state='failed' then return jsonb_build_object('state','failed','code',q.error_code); end if;
  if q.state='reserved' and q.lease_until>clock_timestamp() then
   return jsonb_build_object('state','pending'); end if;
  if q.state='reserved' then
   update private.owner_access_requests set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes'
    where actor_id=p_actor_id and request_id=p_request_id returning * into q;
  end if;
 else
  select * into a from private.owner_access where restaurant_id=p_restaurant_id for update;
  if a.pending_request_id is not null then return jsonb_build_object('state','pending'); end if;
  select * into m from public.restaurant_memberships where restaurant_id=p_restaurant_id;
  fresh:=not found;
  if not fresh and exists(select 1 from public.platform_admins where user_id=m.user_id) then
   raise exception 'admin_not_owner' using errcode='42501'; end if;
  if not fresh and not m.is_active then raise exception 'owner_suspended' using errcode='22023'; end if;
  if r.status<>'active' then raise exception 'restaurant_suspended' using errcode='22023'; end if;
  if fresh then
   insert into private.owner_access(restaurant_id,user_id) values(p_restaurant_id,gen_random_uuid())
    on conflict(restaurant_id) do nothing;
  else
   insert into private.owner_access(restaurant_id,user_id) values(p_restaurant_id,m.user_id)
    on conflict(restaurant_id) do nothing;
  end if;
  select * into a from private.owner_access where restaurant_id=p_restaurant_id for update;
  if not fresh and a.user_id<>m.user_id then raise exception 'owner_mismatch' using errcode='23514'; end if;
  update private.owner_access set login_alias=p_alias,requires_password_change=true,reset_pending=true,
   session_not_before=clock_timestamp(),accepted_session_id=null,generation=p_request_id,pending_request_id=p_request_id,updated_at=now()
   where restaurant_id=p_restaurant_id;
  insert into private.owner_access_requests(actor_id,request_id,restaurant_id,owner_id,owner_email,login_alias,new_user,state)
   values(p_actor_id,p_request_id,p_restaurant_id,a.user_id,r.owner_email,p_alias,fresh,'reserved') returning * into q;
 end if;
 return jsonb_build_object('state',q.state,'ownerId',q.owner_id,'email',q.owner_email,'newUser',q.new_user,
  'leaseToken',q.lease_token,'requestId',q.request_id);
end $$;

create function public.begin_owner_auth(p_actor_id uuid,p_request_id uuid,p_lease_token uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 update private.owner_access_requests set state='auth_started'
 where actor_id=p_actor_id and request_id=p_request_id and lease_token=p_lease_token
  and state='reserved' and lease_until>clock_timestamp();
 return found;
end $$;

create function public.complete_owner_access(p_actor_id uuid,p_request_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare q private.owner_access_requests; a private.owner_access; u jsonb;
begin
 select * into q from private.owner_access_requests where actor_id=p_actor_id and request_id=p_request_id for update;
 if not found then raise exception 'request_missing' using errcode='22023'; end if;
 if q.state='completed' then return false; end if;
 if q.state<>'auth_started' then raise exception 'request_not_started' using errcode='22023'; end if;
 select * into a from private.owner_access where restaurant_id=q.restaurant_id for update;
 if a.pending_request_id is distinct from p_request_id or a.user_id<>q.owner_id then
  raise exception 'request_stale' using errcode='22023'; end if;
 select raw_app_meta_data into u from auth.users where id=q.owner_id;
 if not found or u->>'owner_access_request_id' is distinct from p_request_id::text
  or u->>'owner_access_actor_id' is distinct from p_actor_id::text then
  raise exception 'auth_marker_missing' using errcode='22023'; end if;
 if exists(select 1 from public.platform_admins where user_id=q.owner_id) then
  raise exception 'admin_not_owner' using errcode='42501'; end if;
 if q.new_user then
  insert into public.restaurant_memberships(restaurant_id,user_id) values(q.restaurant_id,q.owner_id);
 else
  if not exists(select 1 from public.restaurant_memberships where restaurant_id=q.restaurant_id and user_id=q.owner_id)
   then raise exception 'membership_missing' using errcode='22023'; end if;
 end if;
 update private.owner_access set reset_pending=false,pending_request_id=null,session_not_before=clock_timestamp(),accepted_session_id=null,updated_at=now() where restaurant_id=q.restaurant_id;
 update private.owner_access_requests set state='completed' where actor_id=p_actor_id and request_id=p_request_id;
 insert into public.security_audit_events(actor_user_id,restaurant_id,action,metadata)
 values(p_actor_id,q.restaurant_id,'owner_temporary_password_set',jsonb_build_object('request_id',p_request_id,'created',q.new_user));
 return true;
end $$;

-- Used only for a definite rejected provider request, never on timeout/network uncertainty.
create function public.fail_owner_access(p_actor_id uuid,p_request_id uuid,p_code text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare q private.owner_access_requests;
begin
 if p_code not in ('OWNER_EMAIL_EXISTS','OWNER_EMAIL_INVALID','PASSWORD_REJECTED','AUTH_RATE_LIMITED') then
  raise exception 'invalid_failure' using errcode='22023'; end if;
 select * into q from private.owner_access_requests where actor_id=p_actor_id and request_id=p_request_id for update;
 if not found or q.state='completed' then return false; end if;
 if exists(select 1 from auth.users where id=q.owner_id
  and raw_app_meta_data->>'owner_access_request_id'=p_request_id::text) then return false; end if;
 update private.owner_access_requests set state='failed',error_code=p_code where actor_id=p_actor_id and request_id=p_request_id;
 if q.new_user then
  delete from private.owner_access where restaurant_id=q.restaurant_id and pending_request_id=p_request_id;
 else
  update private.owner_access set reset_pending=false,pending_request_id=null,updated_at=now()
   where restaurant_id=q.restaurant_id and pending_request_id=p_request_id;
 end if;
 return true;
end $$;

create function public.update_owner_access(p_actor_id uuid,p_restaurant_id uuid,p_alias text,p_is_active boolean default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.restaurant_memberships;
begin
 if not exists(select 1 from public.platform_admins where user_id=p_actor_id and is_active) then
  raise exception 'admin_required' using errcode='42501'; end if;
 perform 1 from public.restaurants where id=p_restaurant_id for update;
 select * into m from public.restaurant_memberships where restaurant_id=p_restaurant_id for update;
 if not found then raise exception 'membership_missing' using errcode='P0002'; end if;
 if exists(select 1 from public.platform_admins where user_id=m.user_id) then
  raise exception 'admin_not_owner' using errcode='42501'; end if;
 if exists(select 1 from private.owner_access where restaurant_id=p_restaurant_id and reset_pending) then
  raise exception 'request_pending' using errcode='22023'; end if;
 update private.owner_access set login_alias=p_alias,updated_at=now() where restaurant_id=p_restaurant_id;
 if p_is_active is not null then
  update public.restaurant_memberships set is_active=p_is_active where restaurant_id=p_restaurant_id;
 end if;
 insert into public.security_audit_events(actor_user_id,restaurant_id,action)
 values(p_actor_id,p_restaurant_id,case when p_is_active is null then 'owner_alias_updated' else 'owner_access_status_updated' end);
 return public.owner_admin_state(p_restaurant_id);
end $$;

create function public.complete_owner_password_change(p_user_id uuid,p_generation uuid,p_session_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare a private.owner_access;
begin
 select * into a from private.owner_access where user_id=p_user_id for update;
 if not found then return true; end if;
 if a.generation is distinct from p_generation or a.reset_pending
  or not exists(select 1 from public.restaurant_memberships m join public.restaurants r on r.id=m.restaurant_id
   where m.user_id=p_user_id and m.is_active and r.status='active')
  or not exists(select 1 from auth.sessions s where s.id=p_session_id and s.user_id=p_user_id
   and (a.session_not_before is null or s.created_at>=a.session_not_before or s.id=a.accepted_session_id))
 then return false; end if;
 update private.owner_access set requires_password_change=false,session_not_before=clock_timestamp(),
  accepted_session_id=p_session_id,generation=gen_random_uuid(),updated_at=now() where user_id=p_user_id;
 insert into public.security_audit_events(actor_user_id,restaurant_id,action)
 values(p_user_id,a.restaurant_id,'owner_password_changed');
 return true;
end $$;

create function private.sync_owner_access() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='restaurant_memberships' then
  if tg_op='INSERT' then
   insert into private.owner_access(restaurant_id,user_id) values(new.restaurant_id,new.user_id)
    on conflict(restaurant_id) do nothing;
  elsif new.is_active is distinct from old.is_active then
   update private.owner_access set session_not_before=clock_timestamp(),accepted_session_id=null,updated_at=now()
    where restaurant_id=new.restaurant_id;
  end if;
 elsif new.status is distinct from old.status then
  update private.owner_access set session_not_before=clock_timestamp(),accepted_session_id=null,updated_at=now()
   where restaurant_id=new.id;
 end if;
 return new;
end $$;
revoke all on function private.sync_owner_access() from public,anon,authenticated;
create trigger sync_owner_access after insert or update of is_active on public.restaurant_memberships
 for each row execute function private.sync_owner_access();
create trigger revoke_owner_on_restaurant_status after update of status on public.restaurants
 for each row execute function private.sync_owner_access();

revoke all on function public.resolve_owner_login(text),public.owner_admin_state(uuid),
 public.claim_owner_access(uuid,uuid,uuid,text),public.begin_owner_auth(uuid,uuid,uuid),
 public.complete_owner_access(uuid,uuid),public.fail_owner_access(uuid,uuid,text),
 public.update_owner_access(uuid,uuid,text,boolean),public.complete_owner_password_change(uuid,uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.resolve_owner_login(text),public.owner_admin_state(uuid),
 public.claim_owner_access(uuid,uuid,uuid,text),public.begin_owner_auth(uuid,uuid,uuid),
 public.complete_owner_access(uuid,uuid),public.fail_owner_access(uuid,uuid,text),
 public.update_owner_access(uuid,uuid,text,boolean),public.complete_owner_password_change(uuid,uuid,uuid)
 to service_role;
-- Invoker RPCs inspect trusted Auth markers/session creation times; never expose auth schema over REST.
grant select(id,raw_app_meta_data) on auth.users to service_role;
grant select(id,user_id,created_at) on auth.sessions to service_role;

alter table public.platform_settings
 add column creator_brand text not null default 'Tolentino Chef' check(char_length(creator_brand) between 1 and 80),
 add column creator_phone text not null default '3108853158' check(creator_phone ~ '^[0-9+() -]{7,24}$'),
 add column creator_whatsapp text not null default 'https://wa.me/573108853158?text=Hola%2C%20quiero%20informaci%C3%B3n%20sobre%20un%20men%C3%BA%20digital%20para%20mi%20restaurante'
 check(creator_whatsapp ~ '^https://wa[.]me/[0-9]{7,15}([?]text=[^[:space:]]*)?$');
