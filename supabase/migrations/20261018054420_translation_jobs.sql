-- Persistent translation jobs: source writes and enqueue share the same transaction.
alter table public.promotions add constraint promotions_tenant_id_unique unique(restaurant_id,id);
alter table public.translations drop constraint translations_entity_type_check;
alter table public.translations add constraint translations_entity_type_check check(entity_type in ('product','category','promotion','restaurant'));
alter table public.translations
 add column promotion_id uuid generated always as (case when entity_type='promotion' then entity_id end) stored,
 add column is_manual boolean not null default true,
 add column source_hash text,
 add constraint translations_promotion_fk foreign key(restaurant_id,promotion_id) references public.promotions(restaurant_id,id) on delete cascade,
 add constraint translations_restaurant_identity check(entity_type<>'restaurant' or entity_id=restaurant_id);
create index translations_promotion_idx on public.translations(restaurant_id,promotion_id);

create table public.translation_jobs(
 id uuid primary key default gen_random_uuid(),
 restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 entity_type text not null check(entity_type in ('product','category','promotion','restaurant')),
 entity_id uuid not null,
 language text not null check(language in ('es','en','fr','it','zh','ja','hi')),
 source_language text not null,
 source_hash text not null,
 source_fields jsonb not null check(jsonb_typeof(source_fields)='object' and octet_length(source_fields::text)<=24000),
 status text not null default 'pending' check(status in ('pending','processing','completed','failed','manual','superseded')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 next_attempt_at timestamptz not null default now(),
 lease_id uuid,
 lease_until timestamptz,
 error_code text check(char_length(error_code)<=80),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(restaurant_id,entity_type,entity_id,language,source_hash)
);
create index translation_jobs_tenant_status_idx on public.translation_jobs(restaurant_id,status,language);
create index translation_jobs_worker_idx on public.translation_jobs(next_attempt_at,created_at) where status in ('pending','processing');
alter table public.translation_jobs enable row level security;
revoke all on public.translation_jobs from public,anon,authenticated;
grant select on public.translation_jobs to authenticated;
grant all on public.translation_jobs to service_role;
create policy translation_jobs_owner_read on public.translation_jobs for select to authenticated using(private.can_manage_restaurant(restaurant_id));

create table private.translation_budget(
 id boolean primary key default true check(id),
 limit_micro_usd bigint not null default 0 check(limit_micro_usd>=0),
 charged_micro_usd bigint not null default 0 check(charged_micro_usd>=0),
 blocked_reason text,
 updated_at timestamptz not null default now()
);
insert into private.translation_budget(id) values(true);
create table private.translation_attempts(
 id uuid primary key,
 job_id uuid not null references public.translation_jobs(id) on delete cascade,
 reserved_micro_usd bigint not null check(reserved_micro_usd>0),
 actual_micro_usd bigint check(actual_micro_usd>=0),
 status text not null default 'reserved',
 error_code text,
 created_at timestamptz not null default now(),
 finished_at timestamptz
);
alter table private.translation_budget enable row level security;
alter table private.translation_attempts enable row level security;
revoke all on private.translation_budget,private.translation_attempts from public,anon,authenticated;

create function private.translation_source(p_restaurant_id uuid,p_type text,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare value jsonb;
begin
 if p_type='product' then
  select jsonb_build_object('name',p.name,'description',p.description,'ingredients',p.ingredients,'tags',p.tags,
   'extras',coalesce((select jsonb_agg(jsonb_build_object('name',x->>'name')) from jsonb_array_elements(p.extras) x),'[]'::jsonb),
   'variants',coalesce((select jsonb_agg(jsonb_build_object('name',x->>'name')) from jsonb_array_elements(p.variants) x),'[]'::jsonb))
  into value from public.products p where p.restaurant_id=p_restaurant_id and p.id=p_id;
 elsif p_type='category' then select jsonb_build_object('name',name) into value from public.categories where restaurant_id=p_restaurant_id and id=p_id;
 elsif p_type='promotion' then select jsonb_build_object('title',title,'description',description) into value from public.promotions where restaurant_id=p_restaurant_id and id=p_id;
 elsif p_type='restaurant' then select jsonb_build_object('description',description) into value from public.restaurants where id=p_restaurant_id and id=p_id;
 end if;
 return value;
end $$;
revoke all on function private.translation_source(uuid,text,uuid) from public,anon,authenticated;

create function private.enqueue_translation_entity(p_restaurant_id uuid,p_type text,p_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare fields jsonb; source_lang text; langs text[]; target_lang text; hash text; inserted integer:=0; n integer;
begin
 fields=private.translation_source(p_restaurant_id,p_type,p_id);
 if fields is null then
  update public.translation_jobs set status='superseded',updated_at=now() where restaurant_id=p_restaurant_id and entity_type=p_type and entity_id=p_id and status in ('pending','processing');
  return 0;
 end if;
 select r.default_language,s.enabled_languages into source_lang,langs from public.restaurants r join public.restaurant_settings s on s.restaurant_id=r.id where r.id=p_restaurant_id;
 if not found then return 0; end if;
 hash=md5(fields::text||':'||source_lang);
 update public.translation_jobs set status='superseded',updated_at=now() where restaurant_id=p_restaurant_id and entity_type=p_type and entity_id=p_id and (source_hash<>hash or language=source_lang or not(language=any(langs))) and status<>'superseded';
 delete from public.translations where restaurant_id=p_restaurant_id and entity_type=p_type and entity_id=p_id and not is_manual and source_hash is distinct from hash;
 if p_type='restaurant' and coalesce(fields->>'description','')='' then return 0; end if;
 foreach target_lang in array langs loop
  if target_lang=source_lang then continue; end if;
  insert into public.translation_jobs(restaurant_id,entity_type,entity_id,language,source_language,source_hash,source_fields,status)
  values(p_restaurant_id,p_type,p_id,target_lang,source_lang,hash,fields,
   case when exists(select 1 from public.translations where restaurant_id=p_restaurant_id and entity_type=p_type and entity_id=p_id and language=target_lang and is_manual) then 'manual' else 'pending' end)
  on conflict(restaurant_id,entity_type,entity_id,language,source_hash) do update set status=case when translation_jobs.status='superseded' then excluded.status else translation_jobs.status end,attempts=case when translation_jobs.status='superseded' then 0 else translation_jobs.attempts end,next_attempt_at=case when translation_jobs.status='superseded' then now() else translation_jobs.next_attempt_at end;
  get diagnostics n=row_count; inserted=inserted+n;
 end loop;
 return inserted;
end $$;
revoke all on function private.enqueue_translation_entity(uuid,text,uuid) from public,anon,authenticated;

create function private.enqueue_restaurant_translations(p_restaurant_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare item record; total integer:=0;
begin
 for item in select 'product' as kind,id from public.products where restaurant_id=p_restaurant_id union all select 'category',id from public.categories where restaurant_id=p_restaurant_id union all select 'promotion',id from public.promotions where restaurant_id=p_restaurant_id union all select 'restaurant',id from public.restaurants where id=p_restaurant_id loop
  total=total+private.enqueue_translation_entity(p_restaurant_id,item.kind,item.id);
 end loop;
 return total;
end $$;
revoke all on function private.enqueue_restaurant_translations(uuid) from public,anon,authenticated;

create function private.queue_menu_translation() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text; tenant uuid;
begin
 kind=case tg_table_name when 'products' then 'product' when 'categories' then 'category' when 'promotions' then 'promotion' else 'restaurant' end;
 if tg_table_name='restaurants' then tenant=coalesce(new.id,old.id);
 else tenant=coalesce(new.restaurant_id,old.restaurant_id); end if;
 if tg_op='DELETE' then
  update public.translation_jobs set status='superseded',updated_at=now() where restaurant_id=tenant and entity_type=kind and entity_id=old.id;
 else perform private.enqueue_translation_entity(tenant,kind,new.id); end if;
 return coalesce(new,old);
end $$;
revoke all on function private.queue_menu_translation() from public,anon,authenticated;
create trigger translate_product after insert or update of name,description,ingredients,tags,extras,variants or delete on public.products for each row execute function private.queue_menu_translation();
create trigger translate_category after insert or update of name or delete on public.categories for each row execute function private.queue_menu_translation();
create trigger translate_promotion after insert or update of title,description or delete on public.promotions for each row execute function private.queue_menu_translation();
create trigger translate_restaurant after update of description on public.restaurants for each row execute function private.queue_menu_translation();
create function private.queue_language_translations() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='restaurants' then perform private.enqueue_restaurant_translations(new.id);
 else perform private.enqueue_restaurant_translations(new.restaurant_id); end if;
 return new;
end $$;
revoke all on function private.queue_language_translations() from public,anon,authenticated;
create trigger translate_language_source after update of default_language on public.restaurants for each row when(old.default_language is distinct from new.default_language) execute function private.queue_language_translations();
create trigger translate_languages_enabled after update of enabled_languages on public.restaurant_settings for each row when(old.enabled_languages is distinct from new.enabled_languages) execute function private.queue_language_translations();

-- Owners can request their own queue, never claim work, set budget or write other tenants.
create function public.request_menu_translations(p_restaurant_id uuid,p_action text default 'enqueue') returns jsonb
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if current_setting('role',true)<>'service_role' and not private.can_manage_restaurant(p_restaurant_id) then raise exception 'not_allowed' using errcode='42501'; end if;
 if p_action not in ('enqueue','retry','regenerate') then raise exception 'invalid_action' using errcode='22023'; end if;
 n=private.enqueue_restaurant_translations(p_restaurant_id);
 if p_action='retry' then
  update public.translation_jobs set status='pending',attempts=0,error_code=null,next_attempt_at=now(),updated_at=now() where restaurant_id=p_restaurant_id and status='failed';
 elsif p_action='regenerate' then
  -- Manual translations stay manual even on automatic regeneration.
  update public.translation_jobs j set status='pending',attempts=0,error_code=null,next_attempt_at=now(),updated_at=now()
   where j.restaurant_id=p_restaurant_id and j.status in ('completed','failed') and not exists(select 1 from public.translations t where t.restaurant_id=j.restaurant_id and t.entity_type=j.entity_type and t.entity_id=j.entity_id and t.language=j.language and t.is_manual);
 end if;
 return jsonb_build_object('enqueued',n,'manual_preserved',true);
end $$;
revoke all on function public.request_menu_translations(uuid,text) from public,anon;
grant execute on function public.request_menu_translations(uuid,text) to authenticated,service_role;

create function public.configure_translation_budget(p_limit_micro_usd bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b private.translation_budget;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'not_allowed' using errcode='42501'; end if;
 if p_limit_micro_usd<0 or p_limit_micro_usd>100000000 then raise exception 'invalid_budget' using errcode='22023'; end if;
 update private.translation_budget set blocked_reason=case when limit_micro_usd<>p_limit_micro_usd then null else blocked_reason end,limit_micro_usd=p_limit_micro_usd,updated_at=now() where id returning * into b;
 return jsonb_build_object('limit_micro_usd',b.limit_micro_usd,'charged_micro_usd',b.charged_micro_usd);
end $$;

create function public.claim_translation_job(p_reserved_micro_usd bigint,p_job_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.translation_jobs; b private.translation_budget; lease uuid:=gen_random_uuid();
begin
 if current_setting('role',true)<>'service_role' then raise exception 'not_allowed' using errcode='42501'; end if;
 if p_reserved_micro_usd<=0 or p_reserved_micro_usd>1000000 then raise exception 'invalid_reservation' using errcode='22023'; end if;
 select * into b from private.translation_budget where id for update;
 if b.charged_micro_usd+p_reserved_micro_usd>b.limit_micro_usd then update private.translation_budget set blocked_reason='budget',updated_at=now() where id; return jsonb_build_object('blocked','budget'); end if;
 update public.translation_jobs set status='failed',error_code='lease_expired_max_attempts',updated_at=now() where status='processing' and lease_until<now() and attempts>=3;
 select * into j from public.translation_jobs q where (p_job_id is null or q.id=p_job_id) and q.attempts<3 and ((q.status='pending' and q.next_attempt_at<=now()) or (q.status='processing' and q.lease_until<now())) and exists(select 1 from public.restaurants r where r.id=q.restaurant_id and r.status='active') order by q.created_at,q.id for update skip locked limit 1;
 if not found then return null; end if;
 -- A previous expired request remains charged at its reserved upper bound: its outcome is unknown.
 update private.translation_budget set charged_micro_usd=charged_micro_usd+p_reserved_micro_usd,blocked_reason=null,updated_at=now() where id;
 insert into private.translation_attempts(id,job_id,reserved_micro_usd) values(lease,j.id,p_reserved_micro_usd);
 update public.translation_jobs set status='processing',attempts=attempts+1,lease_id=lease,lease_until=now()+interval '3 minutes',updated_at=now() where id=j.id returning * into j;
 return to_jsonb(j);
end $$;

create function public.finish_translation_job(p_job_id uuid,p_lease_id uuid,p_fields jsonb,p_actual_micro_usd bigint,p_error_code text default null,p_retryable boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.translation_jobs; a private.translation_attempts; current_fields jsonb; current_lang text; final_status text; write_count integer;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'not_allowed' using errcode='42501'; end if;
 -- Match source-edit lock order; no provider work runs while holding database locks.
 perform 1 from public.restaurants where id=(select restaurant_id from public.translation_jobs where id=p_job_id) for update;
 perform 1 from private.translation_budget where id for update;
 select * into j from public.translation_jobs where id=p_job_id for update;
 if not found or j.lease_id is distinct from p_lease_id then return jsonb_build_object('accepted',false); end if;
 select * into a from private.translation_attempts where id=p_lease_id for update;
 if not found or a.finished_at is not null then return jsonb_build_object('accepted',false); end if;
 if p_actual_micro_usd is not null and (p_actual_micro_usd<0 or p_actual_micro_usd>a.reserved_micro_usd) then raise exception 'invalid_cost' using errcode='22023'; end if;
 update private.translation_budget set charged_micro_usd=charged_micro_usd-(a.reserved_micro_usd-coalesce(p_actual_micro_usd,a.reserved_micro_usd)),blocked_reason=case when p_error_code='provider_unauthorized' then 'provider_unauthorized' else blocked_reason end,updated_at=now() where id;
 update private.translation_attempts set actual_micro_usd=p_actual_micro_usd,status=case when p_error_code is null then 'complete' else 'failed' end,error_code=left(p_error_code,80),finished_at=now() where id=p_lease_id;
 current_fields=private.translation_source(j.restaurant_id,j.entity_type,j.entity_id);
 select default_language into current_lang from public.restaurants where id=j.restaurant_id;
 if j.status='superseded' or current_fields is null or md5(current_fields::text||':'||current_lang)<>j.source_hash then final_status='superseded';
 elsif exists(select 1 from public.translations where restaurant_id=j.restaurant_id and entity_type=j.entity_type and entity_id=j.entity_id and language=j.language and is_manual) then final_status='manual';
 elsif p_error_code is not null then final_status=case when p_retryable and j.attempts<3 then 'pending' else 'failed' end;
 else
  if p_fields is null or jsonb_typeof(p_fields)<>'object' or octet_length(p_fields::text)>16000 then raise exception 'invalid_translation' using errcode='22023'; end if;
  insert into public.translations(restaurant_id,entity_type,entity_id,language,fields,is_manual,source_hash)
   values(j.restaurant_id,j.entity_type,j.entity_id,j.language,p_fields,false,j.source_hash)
   on conflict(restaurant_id,entity_type,entity_id,language) do update set fields=excluded.fields,is_manual=false,source_hash=excluded.source_hash where not translations.is_manual;
  get diagnostics write_count=row_count;
  final_status=case when write_count=0 then 'manual' else 'completed' end;
 end if;
 update public.translation_jobs set status=final_status,error_code=left(p_error_code,80),next_attempt_at=now()+make_interval(secs=>least(300,10*(2^attempts)::integer)),lease_until=null,updated_at=now() where id=j.id;
 return jsonb_build_object('accepted',true,'status',final_status);
end $$;
revoke all on function public.configure_translation_budget(bigint),public.claim_translation_job(bigint,uuid),public.finish_translation_job(uuid,uuid,jsonb,bigint,text,boolean) from public,anon,authenticated;
grant execute on function public.configure_translation_budget(bigint),public.claim_translation_job(bigint,uuid),public.finish_translation_job(uuid,uuid,jsonb,bigint,text,boolean) to service_role;
create function public.translation_job_summary(p_restaurant_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
  select language,count(*) filter(where status='pending') as pending,count(*) filter(where status='processing') as processing,count(*) filter(where status='completed') as completed,count(*) filter(where status='failed') as failed,count(*) filter(where status='manual') as manual
  from public.translation_jobs where restaurant_id=p_restaurant_id and status<>'superseded' group by language order by language
 )x;
$$;
revoke all on function public.translation_job_summary(uuid) from public,anon;
grant execute on function public.translation_job_summary(uuid) to authenticated,service_role;

create function public.save_manual_translation(p_restaurant_id uuid,p_entity_type text,p_entity_id uuid,p_language text,p_fields jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if current_user<>'service_role' and not private.can_manage_restaurant(p_restaurant_id) then raise exception 'not_allowed' using errcode='42501'; end if;
 perform 1 from public.restaurants where id=p_restaurant_id for update;
 insert into public.translations(restaurant_id,entity_type,entity_id,language,fields,is_manual)
 values(p_restaurant_id,p_entity_type,p_entity_id,p_language,p_fields,true)
 on conflict(restaurant_id,entity_type,entity_id,language) do update set fields=translations.fields||excluded.fields,is_manual=true
 returning fields into result;
 return result;
end $$;
revoke all on function public.save_manual_translation(uuid,text,uuid,text,jsonb) from public,anon;
grant execute on function public.save_manual_translation(uuid,text,uuid,text,jsonb) to authenticated,service_role;
create function public.translation_worker_state() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('reason',blocked_reason) from private.translation_budget where id;
$$;
revoke all on function public.translation_worker_state() from public,anon,authenticated;
grant execute on function public.translation_worker_state() to service_role;
