-- Durable creation attempts coordinate Auth and PostgreSQL without trusting browser state.
-- All endpoints are invoker/service-only. No owner or anonymous access to request records.
alter table public.restaurants add column is_demo boolean not null default false;
alter table public.restaurants add constraint restaurants_demo_email_check
 check (not is_demo or lower(owner_email) ~ '@[^@]+[.]test$');

create table private.restaurant_creation_requests (
 actor_id uuid not null references public.platform_admins(user_id) on delete restrict,
 request_id uuid not null,
 request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
 restaurant_id uuid not null unique default gen_random_uuid(),
 owner_id uuid not null unique default gen_random_uuid(),
 state text not null default 'processing' check(state in('processing','cleanup','completed','failed')),
 lease_token uuid not null default gen_random_uuid(),
 lease_until timestamptz not null default clock_timestamp()+interval '2 minutes',
 response jsonb,
 http_status integer check(http_status between 200 and 599),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(actor_id,request_id)
);
alter table private.restaurant_creation_requests enable row level security;
revoke all on private.restaurant_creation_requests from public,anon,authenticated;
grant select,insert,update on private.restaurant_creation_requests to service_role;

create function public.claim_restaurant_creation(p_actor_id uuid,p_request_id uuid,p_request_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r private.restaurant_creation_requests; inserted boolean;
begin
 if not exists(select 1 from public.platform_admins where user_id=p_actor_id and is_active) then
  raise exception 'active_superadmin_required' using errcode='42501';
 end if;
 insert into private.restaurant_creation_requests(actor_id,request_id,request_hash)
 values(p_actor_id,p_request_id,p_request_hash) on conflict(actor_id,request_id) do nothing;
 inserted=found;
 select * into strict r from private.restaurant_creation_requests
 where actor_id=p_actor_id and request_id=p_request_id for update;
 if r.request_hash<>p_request_hash then return jsonb_build_object('state','mismatch'); end if;
 if r.state in('completed','failed') then
  return jsonb_build_object('state',r.state,'response',r.response,'http_status',r.http_status);
 end if;
 if not inserted and r.lease_until>clock_timestamp() then return jsonb_build_object('state','pending'); end if;
 if not inserted then
  update private.restaurant_creation_requests set lease_token=gen_random_uuid(),
   lease_until=clock_timestamp()+interval '2 minutes',updated_at=now()
  where actor_id=p_actor_id and request_id=p_request_id returning * into r;
 end if;
 return jsonb_build_object('state',r.state,'lease_token',r.lease_token,'restaurant_id',r.restaurant_id,
  'owner_id',r.owner_id,'response',r.response,'http_status',r.http_status);
end $$;

create function public.complete_restaurant_creation(
 p_actor_id uuid,p_request_id uuid,p_lease_token uuid,p_data jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r private.restaurant_creation_requests; result jsonb; demo boolean;
begin
 if not exists(select 1 from public.platform_admins where user_id=p_actor_id and is_active) then
  raise exception 'active_superadmin_required' using errcode='42501';
 end if;
 select * into strict r from private.restaurant_creation_requests
 where actor_id=p_actor_id and request_id=p_request_id for update;
 if r.state='completed' then return jsonb_build_object('committed',false,'response',r.response); end if;
 if r.state<>'processing' or r.lease_token<>p_lease_token then
  raise exception 'creation_lease_lost' using errcode='40001';
 end if;
 demo=coalesce((p_data->>'demo')::boolean,false);
 if demo and coalesce(p_data->>'owner_email','') !~* '@[^@]+[.]test$' then
  raise exception 'demo_email_required' using errcode='22023';
 end if;
 perform public.provision_restaurant(
  r.restaurant_id,r.owner_id,p_data->>'name',p_data->>'slug',
  p_data->>'owner_name',p_data->>'owner_email',coalesce(p_data->>'phone',''),
  coalesce(p_data->>'currency','COP'),coalesce(p_data->>'default_language','es'),
  coalesce((p_data->>'amount')::numeric,0),coalesce(p_data->>'sale_currency','COP'),
  coalesce(p_data->>'notes',''),coalesce(p_data->>'description',''),
  coalesce(p_data->>'status','active'),coalesce((p_data->>'sold_at')::timestamptz,r.created_at)
 );
 update public.restaurants set is_demo=demo where id=r.restaurant_id;
 result=jsonb_build_object('ok',true,'restaurantId',r.restaurant_id,'invitationSent',false,'demo',demo,
  'message',case when demo then 'Restaurante DEMO creado. No se enviaron correos.'
   else 'Restaurante creado. El envío de activación no está confirmado; puedes restablecer el acceso desde el panel.' end);
 insert into public.security_audit_events(actor_user_id,restaurant_id,action,metadata)
 values(p_actor_id,r.restaurant_id,'restaurant_created',jsonb_build_object('request_id',p_request_id,'demo',demo));
 update private.restaurant_creation_requests set state='completed',response=result,http_status=201,updated_at=now()
 where actor_id=p_actor_id and request_id=p_request_id;
 return jsonb_build_object('committed',true,'response',result);
end $$;

-- retry releases a lease but keeps both reserved IDs. cleanup is durable and may only
-- finish as failed: it never re-enters provisioning, including after a crashed worker.
create function public.settle_restaurant_creation(
 p_actor_id uuid,p_request_id uuid,p_lease_token uuid,p_outcome text,
 p_response jsonb default null,p_http_status integer default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r private.restaurant_creation_requests;
begin
 if not exists(select 1 from public.platform_admins where user_id=p_actor_id and is_active) then
  raise exception 'active_superadmin_required' using errcode='42501';
 end if;
 if p_outcome not in('retry','cleanup','failed','invited') then
  raise exception 'invalid_creation_outcome' using errcode='22023';
 end if;
 select * into strict r from private.restaurant_creation_requests
 where actor_id=p_actor_id and request_id=p_request_id for update;
 if r.lease_token<>p_lease_token then return jsonb_build_object('state','pending'); end if;
 if r.state='completed' then
  if p_outcome='invited' and not coalesce((r.response->>'demo')::boolean,false) then
   update private.restaurant_creation_requests
   set response=response||jsonb_build_object('invitationSent',true,
    'message','Restaurante creado. El propietario recibirá un enlace para definir su contraseña.'),updated_at=now()
   where actor_id=p_actor_id and request_id=p_request_id returning * into r;
  end if;
 elsif r.state<>'failed' then
  if p_outcome='retry' and r.state='processing' then
   update private.restaurant_creation_requests set lease_until=clock_timestamp(),updated_at=now()
   where actor_id=p_actor_id and request_id=p_request_id returning * into r;
  elsif p_outcome in('cleanup','failed') then
   if p_response is null or p_http_status not between 400 and 599 then
    raise exception 'invalid_creation_error' using errcode='22023';
   end if;
   update private.restaurant_creation_requests set state=p_outcome,response=p_response,http_status=p_http_status,
    updated_at=now() where actor_id=p_actor_id and request_id=p_request_id returning * into r;
  else raise exception 'invalid_creation_transition' using errcode='22023';
  end if;
 end if;
 return jsonb_build_object('state',r.state,'response',r.response,'http_status',r.http_status);
end $$;
revoke all on function public.claim_restaurant_creation(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.complete_restaurant_creation(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.settle_restaurant_creation(uuid,uuid,uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.claim_restaurant_creation(uuid,uuid,text) to service_role;
grant execute on function public.complete_restaurant_creation(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.settle_restaurant_creation(uuid,uuid,uuid,text,jsonb,integer) to service_role;
