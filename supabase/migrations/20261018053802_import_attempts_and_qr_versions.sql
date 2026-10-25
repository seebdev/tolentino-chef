-- Incremental repair: no catalog replacement or deletion. Private attempt journal,
-- atomic replay protection and optimistic QR configuration versions.
create table private.import_attempts (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  id uuid not null,
  actor_user_id uuid not null references auth.users(id),
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
  status text not null check(status in ('completed','failed')),
  result jsonb not null check(jsonb_typeof(result)='object'),
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  primary key(restaurant_id,id)
);
alter table private.import_attempts enable row level security;
revoke all on private.import_attempts from public,anon,authenticated;
grant select on private.import_attempts to service_role;

create function private.assert_import_actor(p_restaurant_id uuid,p_actor_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_actor_user_id is null then raise exception 'actor_required' using errcode='42501'; end if;
 if current_setting('role',true)='service_role' then
   if not exists(select 1 from public.platform_admins where user_id=p_actor_user_id and is_active)
   then raise exception 'admin_required' using errcode='42501'; end if;
 else
   if (select auth.uid()) is distinct from p_actor_user_id or not private.can_manage_restaurant(p_restaurant_id)
   then raise exception 'tenant_access_denied' using errcode='42501'; end if;
 end if;
 if not exists(select 1 from public.restaurants where id=p_restaurant_id and status='active')
 then raise exception 'restaurant_unavailable' using errcode='42501'; end if;
end $$;
revoke all on function private.assert_import_actor(uuid,uuid) from public,anon,authenticated,service_role;

-- The original SECURITY INVOKER import remains the sole catalog implementation.
-- A definer wrapper changes current_user, but not PostgREST's effective role setting.
-- Do not use editable JWT metadata to detect service authority.
do $$ declare definition text; begin
 select pg_get_functiondef('public.import_products(uuid,jsonb,text,boolean)'::regprocedure) into definition;
 if position('current_user <> ''service_role''' in definition)=0 then
   raise exception 'import_guard_definition_changed';
 end if;
 execute replace(definition,'current_user <> ''service_role''','current_setting(''role'',true) <> ''service_role''');
end $$;

create function public.import_products_attempt(p_restaurant_id uuid,p_attempt_id uuid,p_request_hash text,p_rows jsonb,p_mode text,p_create_categories boolean,p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous private.import_attempts%rowtype; outcome jsonb; state text; fingerprint text;
begin
 perform private.assert_import_actor(p_restaurant_id,p_actor_user_id);
 if p_attempt_id is null or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$'
 or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 1000
 or p_mode is null or p_mode not in ('skip','update') or p_create_categories is null
 then raise exception 'invalid_import_request' using errcode='22023'; end if;
 fingerprint=encode(sha256(convert_to(jsonb_build_object('rows',p_rows,'mode',p_mode,'create_categories',p_create_categories)::text,'UTF8')),'hex');
 -- The restaurant lock serializes concurrent requests, including distinct attempt IDs.
 perform 1 from public.restaurants where id=p_restaurant_id for update;
 select * into previous from private.import_attempts where restaurant_id=p_restaurant_id and id=p_attempt_id;
 if found then
   if previous.request_hash<>p_request_hash or previous.payload_hash<>fingerprint or previous.actor_user_id<>p_actor_user_id
   then raise exception 'import_attempt_conflict' using errcode='40001'; end if;
   return jsonb_build_object('attempt_id',p_attempt_id,'status',previous.status,'replayed',true,'result',previous.result);
 end if;
 begin
   outcome=public.import_products(p_restaurant_id,p_rows,p_mode,p_create_categories);
   outcome=outcome || jsonb_build_object('total',jsonb_array_length(p_rows),'rejected',0);
   state='completed';
 exception when others then
   -- This subtransaction rolls back ALL product/category writes and enqueue triggers.
   -- SQLERRM can contain customer content: store only a generic code, never row data.
   outcome=jsonb_build_object('inserted',0,'updated',0,'skipped',0,'categories_created',0,'total',jsonb_array_length(p_rows),'rejected',jsonb_array_length(p_rows),'error_code','IMPORT_TRANSACTION_REJECTED');
   state='failed';
 end;
 insert into private.import_attempts(restaurant_id,id,actor_user_id,request_hash,payload_hash,status,result)
 values(p_restaurant_id,p_attempt_id,p_actor_user_id,p_request_hash,fingerprint,state,outcome);
 insert into public.security_audit_events(actor_user_id,action,restaurant_id,metadata)
 values(p_actor_user_id,'csv_import_'||state,p_restaurant_id,jsonb_build_object('attempt_id',p_attempt_id,'counts',outcome));
 return jsonb_build_object('attempt_id',p_attempt_id,'status',state,'replayed',false,'result',outcome);
end $$;
revoke all on function public.import_products_attempt(uuid,uuid,text,jsonb,text,boolean,uuid) from public,anon;
grant execute on function public.import_products_attempt(uuid,uuid,text,jsonb,text,boolean,uuid) to authenticated,service_role;

create function public.get_import_attempt(p_restaurant_id uuid,p_attempt_id uuid,p_actor_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare attempt private.import_attempts%rowtype;
begin
 perform private.assert_import_actor(p_restaurant_id,p_actor_user_id);
 select * into attempt from private.import_attempts where restaurant_id=p_restaurant_id and id=p_attempt_id;
 if not found then return jsonb_build_object('found',false,'attempt_id',p_attempt_id); end if;
 return jsonb_build_object('found',true,'attempt_id',attempt.id,'status',attempt.status,'result',attempt.result,'completed_at',attempt.completed_at);
end $$;
revoke all on function public.get_import_attempt(uuid,uuid,uuid) from public,anon;
grant execute on function public.get_import_attempt(uuid,uuid,uuid) to authenticated,service_role;

alter table public.restaurant_qr_configs
 add column config_version integer not null default 1 check(config_version>0),
 add column logo_size integer not null default 14 check(logo_size between 8 and 14),
 add column font_family text not null default 'sans' check(font_family in ('sans','serif','mono')),
 add column export_size integer not null default 1024 check(export_size in (256,512,1024,2048)),
 add column module_style text not null default 'square' check(module_style in ('square','rounded'));

create function public.save_qr_configuration(p_restaurant_id uuid,p_config jsonb,p_expected_version integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved public.restaurant_qr_configs%rowtype;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'admin_required' using errcode='42501'; end if;
 update public.restaurant_qr_configs set foreground=p_config->>'foreground',background=p_config->>'background',
 frame=p_config->>'frame',label=p_config->>'label',include_logo=(p_config->>'include_logo')::boolean,
 logo_size=(p_config->>'logo_size')::integer,font_family=p_config->>'font_family',export_size=(p_config->>'export_size')::integer,
 module_style=p_config->>'module_style',config_version=config_version+1
 where restaurant_id=p_restaurant_id and config_version=p_expected_version returning * into saved;
 if not found then raise exception 'qr_version_conflict' using errcode='40001'; end if;
 return to_jsonb(saved);
end $$;
revoke all on function public.save_qr_configuration(uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.save_qr_configuration(uuid,jsonb,integer) to service_role;
