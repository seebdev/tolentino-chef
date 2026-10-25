-- Preserve manual provenance per top-level field while filling automatic fields.
-- Existing text is retained; empty placeholders are not manual translations.
alter table public.translations add column manual_fields text[] not null default '{}';

create function private.translation_has_text(p_value jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare item jsonb;
begin
 if jsonb_typeof(p_value)='string' then return btrim(p_value#>>'{}')<>''; end if;
 if jsonb_typeof(p_value)='array' then
  for item in select value from jsonb_array_elements(p_value) loop
   if private.translation_has_text(item) then return true; end if;
  end loop;
 elsif jsonb_typeof(p_value)='object' then
  for item in select value from jsonb_each(p_value) loop
   if private.translation_has_text(item) then return true; end if;
  end loop;
 end if;
 return false;
end $$;

create function private.translation_shape_matches(p_source jsonb,p_target jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare item record; n integer;
begin
 if p_target is null or jsonb_typeof(p_source) is distinct from jsonb_typeof(p_target) then return false; end if;
 if jsonb_typeof(p_source)='string' then
  return case when btrim(p_source#>>'{}')='' then btrim(p_target#>>'{}')='' else btrim(p_target#>>'{}')<>'' end;
 elsif jsonb_typeof(p_source)='array' then
  if jsonb_array_length(p_source)<>jsonb_array_length(p_target) then return false; end if;
  for n in 0..jsonb_array_length(p_source)-1 loop
   if not private.translation_shape_matches(p_source->n,p_target->n) then return false; end if;
  end loop;
  return true;
 elsif jsonb_typeof(p_source)='object' then
  if (select count(*) from jsonb_object_keys(p_source))<>(select count(*) from jsonb_object_keys(p_target)) then return false; end if;
  for item in select key,value from jsonb_each(p_source) loop
   if not private.translation_shape_matches(item.value,p_target->item.key) then return false; end if;
  end loop;
  return true;
 end if;
 return false;
end $$;

create function private.translation_manual_values(p_fields jsonb,p_keys text[]) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(p_fields) where key=any(p_keys);
$$;

create function private.translation_manual_complete(p_source jsonb,p_fields jsonb,p_keys text[]) returns boolean
language sql immutable security invoker set search_path='' as $$
 select not exists(select 1 from jsonb_each(p_source) e where private.translation_has_text(e.value)
  and (not(e.key=any(p_keys)) or not private.translation_shape_matches(e.value,p_fields->e.key)));
$$;

create function private.valid_translation_fields(p_type text,p_fields jsonb,p_keys text[]) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare allowed text[]; item record; part jsonb; k text;
begin
 allowed=case p_type when 'product' then array['name','description','ingredients','tags','extras','variants']
  when 'category' then array['name'] when 'promotion' then array['title','description']
  when 'restaurant' then array['description'] else null end;
 if allowed is null or jsonb_typeof(p_fields) is distinct from 'object' or octet_length(p_fields::text)>16000
  or p_keys is null or cardinality(p_keys)>6 or array_ndims(p_keys)>1 or array_position(p_keys,null) is not null
  or cardinality(p_keys)<>(select count(distinct value) from unnest(p_keys) value) then return false; end if;
 foreach k in array p_keys loop
  if not(k=any(allowed)) or not(p_fields ? k) or not private.translation_has_text(p_fields->k) then return false; end if;
 end loop;
 for item in select key,value from jsonb_each(p_fields) loop
  if not(item.key=any(allowed)) then return false; end if;
  if item.key in ('name','description','ingredients','title') then
   if jsonb_typeof(item.value)<>'string' or char_length(item.value#>>'{}')>3000 then return false; end if;
  else
   if jsonb_typeof(item.value)<>'array' then return false; end if;
   for part in select value from jsonb_array_elements(item.value) loop
    if item.key='tags' then
     if jsonb_typeof(part)<>'string' or char_length(part#>>'{}')>3000 then return false; end if;
    elsif jsonb_typeof(part)<>'object' or not(part ? 'name') or (select count(*) from jsonb_object_keys(part))<>1
     or jsonb_typeof(part->'name')<>'string' or char_length(part->>'name')>3000 then return false;
    end if;
   end loop;
  end if;
 end loop;
 return true;
end $$;
revoke all on function private.translation_has_text(jsonb),private.translation_shape_matches(jsonb,jsonb),
 private.translation_manual_values(jsonb,text[]),private.translation_manual_complete(jsonb,jsonb,text[]),
 private.valid_translation_fields(text,jsonb,text[]) from public,anon;
grant execute on function private.translation_has_text(jsonb),private.translation_shape_matches(jsonb,jsonb),
 private.translation_manual_values(jsonb,text[]),private.translation_manual_complete(jsonb,jsonb,text[]),
 private.valid_translation_fields(text,jsonb,text[]) to authenticated,service_role;

update public.translations t set manual_fields=coalesce((select array_agg(key order by key) from jsonb_each(t.fields) where private.translation_has_text(value)),'{}'::text[]) where is_manual;
update public.translations set is_manual=cardinality(manual_fields)>0 where is_manual is distinct from (cardinality(manual_fields)>0);
alter table public.translations add constraint translations_manual_fields_valid
 check(private.valid_translation_fields(entity_type,fields,manual_fields) and is_manual=(cardinality(manual_fields)>0));

-- Legacy direct inserts remain manual. Direct owner edits are manual, never an automatic stamp.
create function private.normalize_translation_manual_fields() returns trigger
language plpgsql security invoker set search_path='' as $$
declare k text; keys text[];
begin
 if tg_op='INSERT' and new.is_manual and cardinality(new.manual_fields)=0 then
  new.manual_fields=coalesce((select array_agg(key order by key) from jsonb_each(new.fields) where private.translation_has_text(value)),'{}'::text[]);
 elsif tg_op='UPDATE' and current_user='authenticated' and new.fields is distinct from old.fields and new.manual_fields is not distinct from old.manual_fields then
  keys=old.manual_fields;
  for k in select key from jsonb_each(new.fields) loop
   if new.fields->k is distinct from old.fields->k then
    keys=array_remove(keys,k);
    if private.translation_has_text(new.fields->k) then keys=array_append(keys,k); end if;
   end if;
  end loop;
  new.manual_fields=coalesce((select array_agg(distinct value order by value) from unnest(keys) value where new.fields ? value),'{}'::text[]);
  new.source_hash=old.source_hash;
 end if;
 new.is_manual=cardinality(new.manual_fields)>0;
 return new;
end $$;
revoke all on function private.normalize_translation_manual_fields() from public,anon,authenticated;
create trigger normalize_translation_manual_fields before insert or update on public.translations for each row execute function private.normalize_translation_manual_fields();

create or replace function private.enqueue_translation_entity(p_restaurant_id uuid,p_type text,p_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare fields jsonb; source_lang text; langs text[]; target_lang text; hash text; inserted integer:=0; n integer;
 t public.translations; desired text;
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
 delete from public.translations where restaurant_id=p_restaurant_id and entity_type=p_type and entity_id=p_id and cardinality(manual_fields)=0 and source_hash is distinct from hash;
 update public.translations set fields=private.translation_manual_values(translations.fields,manual_fields),source_hash=null
  where restaurant_id=p_restaurant_id and entity_type=p_type and entity_id=p_id and cardinality(manual_fields)>0 and source_hash is not null and source_hash is distinct from hash;
 if p_type='restaurant' and not private.translation_has_text(fields) then return 0; end if;
 foreach target_lang in array langs loop
  if target_lang=source_lang then continue; end if;
  select * into t from public.translations where restaurant_id=p_restaurant_id and entity_type=p_type and entity_id=p_id and language=target_lang;
  desired=case when found and private.translation_manual_complete(fields,t.fields,t.manual_fields) then 'manual'
   when found and t.source_hash=hash and private.translation_shape_matches(fields,t.fields) then 'completed' else 'pending' end;
  insert into public.translation_jobs(restaurant_id,entity_type,entity_id,language,source_language,source_hash,source_fields,status)
   values(p_restaurant_id,p_type,p_id,target_lang,source_lang,hash,fields,desired)
   on conflict(restaurant_id,entity_type,entity_id,language,source_hash) do update set
    status=case when translation_jobs.status='superseded' or excluded.status='manual' or (translation_jobs.status in ('manual','completed') and excluded.status='pending') then excluded.status else translation_jobs.status end,
    attempts=case when translation_jobs.status='superseded' or (translation_jobs.status in ('manual','completed') and excluded.status='pending') then 0 else translation_jobs.attempts end,
    lease_id=case when translation_jobs.status='superseded' or (translation_jobs.status in ('manual','completed') and excluded.status='pending') then null else translation_jobs.lease_id end,
    lease_until=case when translation_jobs.status='superseded' or (translation_jobs.status in ('manual','completed') and excluded.status='pending') then null else translation_jobs.lease_until end,
    next_attempt_at=case when translation_jobs.status='superseded' or (translation_jobs.status in ('manual','completed') and excluded.status='pending') then now() else translation_jobs.next_attempt_at end,
    updated_at=now();
  get diagnostics n=row_count; inserted=inserted+n;
 end loop;
 return inserted;
end $$;

create or replace function public.request_menu_translations(p_restaurant_id uuid,p_action text default 'enqueue') returns jsonb
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if current_setting('role',true)<>'service_role' and not private.can_manage_restaurant(p_restaurant_id) then raise exception 'not_allowed' using errcode='42501'; end if;
 if p_action not in ('enqueue','retry','regenerate') then raise exception 'invalid_action' using errcode='22023'; end if;
 perform 1 from public.restaurants where id=p_restaurant_id for update;
 n=private.enqueue_restaurant_translations(p_restaurant_id);
 if p_action='retry' then
  update public.translation_jobs set status='pending',attempts=0,error_code=null,next_attempt_at=now(),updated_at=now() where restaurant_id=p_restaurant_id and status='failed';
 elsif p_action='regenerate' then
  update public.translation_jobs j set status='pending',attempts=0,error_code=null,lease_id=null,lease_until=null,next_attempt_at=now(),updated_at=now()
   where j.restaurant_id=p_restaurant_id and j.status in ('completed','failed') and not exists(
    select 1 from public.translations t where t.restaurant_id=j.restaurant_id and t.entity_type=j.entity_type and t.entity_id=j.entity_id and t.language=j.language and private.translation_manual_complete(j.source_fields,t.fields,t.manual_fields));
 end if;
 return jsonb_build_object('enqueued',n,'manual_preserved',true);
end $$;

create or replace function public.finish_translation_job(p_job_id uuid,p_lease_id uuid,p_fields jsonb,p_actual_micro_usd bigint,p_error_code text default null,p_retryable boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.translation_jobs; a private.translation_attempts; t public.translations;
 current_fields jsonb; current_lang text; langs text[]; final_status text; merged jsonb; mask text[]; final_error text=p_error_code;
begin
 if current_setting('role',true)<>'service_role' then raise exception 'not_allowed' using errcode='42501'; end if;
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
 select r.default_language,s.enabled_languages into current_lang,langs from public.restaurants r join public.restaurant_settings s on s.restaurant_id=r.id where r.id=j.restaurant_id;
 select * into t from public.translations where restaurant_id=j.restaurant_id and entity_type=j.entity_type and entity_id=j.entity_id and language=j.language for update;
 mask=coalesce(t.manual_fields,'{}'::text[]);
 if j.status='superseded' or current_fields is null or md5(current_fields::text||':'||current_lang)<>j.source_hash or j.language=current_lang or not(j.language=any(langs)) then final_status='superseded';
 elsif private.translation_manual_complete(current_fields,coalesce(t.fields,'{}'::jsonb),mask) then final_status='manual';
 elsif p_error_code is not null then final_status=case when p_retryable and j.attempts<3 then 'pending' else 'failed' end;
 elsif not private.valid_translation_fields(j.entity_type,p_fields,'{}'::text[]) or not private.translation_shape_matches(current_fields,p_fields) then
  final_status='failed';final_error='invalid_translation';
 else
  merged=p_fields||private.translation_manual_values(coalesce(t.fields,'{}'::jsonb),mask);
  insert into public.translations(restaurant_id,entity_type,entity_id,language,fields,is_manual,manual_fields,source_hash)
   values(j.restaurant_id,j.entity_type,j.entity_id,j.language,merged,cardinality(mask)>0,mask,j.source_hash)
   on conflict(restaurant_id,entity_type,entity_id,language) do update set fields=excluded.fields,is_manual=excluded.is_manual,manual_fields=excluded.manual_fields,source_hash=excluded.source_hash;
  final_status=case when private.translation_shape_matches(current_fields,merged) then 'completed' else 'failed' end;
  if final_status='failed' then final_error='manual_source_shape_changed'; end if;
 end if;
 update public.translation_jobs set status=final_status,error_code=left(final_error,80),next_attempt_at=now()+make_interval(secs=>least(300,10*(2^attempts)::integer)),lease_until=null,updated_at=now() where id=j.id;
 return jsonb_build_object('accepted',true,'status',final_status);
end $$;

-- This RPC alone elevates the validated owner to update the queue in the same transaction.
create or replace function public.save_manual_translation(p_restaurant_id uuid,p_entity_type text,p_entity_id uuid,p_language text,p_fields jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; t public.translations; source jsonb; source_lang text; keys text[]; accepted jsonb='{}'::jsonb; item record;
begin
 if current_setting('role',true)<>'service_role' and not private.can_manage_restaurant(p_restaurant_id) then raise exception 'not_allowed' using errcode='42501'; end if;
 perform 1 from public.restaurants where id=p_restaurant_id for update;
 source=private.translation_source(p_restaurant_id,p_entity_type,p_entity_id);
 if source is null or not private.valid_translation_fields(p_entity_type,p_fields,'{}'::text[]) then raise exception 'invalid_translation' using errcode='22023'; end if;
 select default_language into source_lang from public.restaurants where id=p_restaurant_id;
 if p_language=source_lang or not exists(select 1 from public.restaurant_settings where restaurant_id=p_restaurant_id and p_language=any(enabled_languages)) then raise exception 'invalid_translation_language' using errcode='22023'; end if;
 select * into t from public.translations where restaurant_id=p_restaurant_id and entity_type=p_entity_type and entity_id=p_entity_id and language=p_language for update;
 keys=coalesce(t.manual_fields,'{}'::text[]);
 for item in select key,value from jsonb_each(p_fields) loop
  -- Blank form placeholders never erase or freeze existing translations.
  if not private.translation_has_text(item.value) and not(jsonb_typeof(item.value)='string' and jsonb_typeof(source->item.key)='string' and not private.translation_has_text(source->item.key)) then continue; end if;
  if not private.translation_shape_matches(source->item.key,item.value) then
   raise exception 'translation_array_incomplete' using errcode='22023';
  end if;
  accepted=accepted||jsonb_build_object(item.key,item.value);
  if private.translation_has_text(item.value) and not(item.key=any(keys)) then keys=array_append(keys,item.key); end if;
 end loop;
 if accepted='{}'::jsonb then return coalesce(t.fields,'{}'::jsonb); end if;
 insert into public.translations(restaurant_id,entity_type,entity_id,language,fields,is_manual,manual_fields,source_hash)
 values(p_restaurant_id,p_entity_type,p_entity_id,p_language,coalesce(t.fields,'{}'::jsonb)||accepted,true,keys,t.source_hash)
 on conflict(restaurant_id,entity_type,entity_id,language) do update set fields=excluded.fields,is_manual=true,manual_fields=excluded.manual_fields
 returning fields into result;
 perform private.enqueue_translation_entity(p_restaurant_id,p_entity_type,p_entity_id);
 return result;
end $$;
revoke all on function public.save_manual_translation(uuid,text,uuid,text,jsonb) from public,anon;
grant execute on function public.save_manual_translation(uuid,text,uuid,text,jsonb) to authenticated,service_role;

-- Reclassify legacy manual partials without invoking any provider or changing their text.
do $$ declare tenant uuid; begin
 for tenant in select id from public.restaurants loop perform private.enqueue_restaurant_translations(tenant); end loop;
end $$;
