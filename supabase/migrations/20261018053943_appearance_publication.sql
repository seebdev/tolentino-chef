-- Draft metadata and appearance publish as one transaction with optimistic revision checks.
alter table public.restaurant_settings
 add column appearance_revision bigint not null default 0 check(appearance_revision>=0),
 add column draft_name text check(draft_name is null or char_length(draft_name) between 2 and 100),
 add column draft_description text check(draft_description is null or char_length(draft_description)<=1200);

create or replace function private.valid_appearance(p_value jsonb,p_restaurant_id uuid)
returns boolean language sql immutable security invoker set search_path='' as $$
 select jsonb_typeof(p_value)='object' and octet_length(p_value::text)<=8000 and not exists (
  select 1 from jsonb_each(p_value) e where
   e.key not in ('primary','secondary','background','card','text','muted','cover_overlay','cover_overlay_opacity','font','logo_path','cover_path','favicon_path','columns_mobile','columns_desktop')
   or (e.key in ('primary','secondary','background','card','text','muted','cover_overlay') and (jsonb_typeof(e.value)<>'string' or (e.value#>>'{}') !~ '^#[0-9A-Fa-f]{6}$'))
   or (e.key='font' and (jsonb_typeof(e.value)<>'string' or (e.value#>>'{}') not in ('serif','sans','rounded')))
   or (e.key in ('columns_mobile','columns_desktop') and e.value not in ('1'::jsonb,'2'::jsonb))
   or (e.key='cover_overlay_opacity' and case when jsonb_typeof(e.value)='number' then (e.value#>>'{}')::numeric not between 0 and 1 else true end)
   or (e.key in ('logo_path','cover_path','favicon_path') and e.value<>'null'::jsonb and
    (jsonb_typeof(e.value)<>'string' or split_part(e.value#>>'{}','/',1)<>p_restaurant_id::text
     or (e.value#>>'{}') !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|avif)$'))
 );
$$;

create function public.save_restaurant_appearance(
 p_restaurant_id uuid,p_appearance jsonb,p_name text,p_description text,
 p_expected_revision bigint,p_publish boolean default false
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.restaurant_settings; r public.restaurants; merged jsonb; next_name text; next_description text;
begin
 if current_user<>'service_role' and not private.can_manage_restaurant(p_restaurant_id) then
  raise exception 'not_allowed' using errcode='42501';
 end if;
 if p_expected_revision is null or p_expected_revision<0 or p_publish is null or not coalesce(private.valid_appearance(p_appearance,p_restaurant_id),false) then
  raise exception 'invalid_appearance' using errcode='22023';
 end if;
 select * into s from public.restaurant_settings where restaurant_id=p_restaurant_id for update;
 if not found then raise exception 'not_allowed' using errcode='42501'; end if;
 if s.appearance_revision<>p_expected_revision then raise exception 'revision_conflict' using errcode='40001'; end if;
 select * into r from public.restaurants where id=p_restaurant_id;
 merged=s.draft_appearance || p_appearance;
 next_name=coalesce(p_name,s.draft_name,r.name);
 next_description=coalesce(p_description,s.draft_description,r.description);
 if char_length(btrim(next_name)) not between 2 and 100 or char_length(next_description)>1200 then
  raise exception 'invalid_details' using errcode='22023';
 end if;
 update public.restaurant_settings set
  draft_appearance=merged,draft_name=btrim(next_name),draft_description=next_description,
  appearance=case when p_publish then merged else appearance end,
  appearance_revision=appearance_revision+1
 where restaurant_id=p_restaurant_id returning * into s;
 if p_publish then
  update public.restaurants set name=btrim(next_name),description=next_description where id=p_restaurant_id;
 end if;
 return jsonb_build_object('appearance_revision',s.appearance_revision,'draft_appearance',s.draft_appearance,
  'draft_name',s.draft_name,'draft_description',s.draft_description,'appearance',s.appearance,'published',p_publish);
end $$;
revoke all on function public.save_restaurant_appearance(uuid,jsonb,text,text,bigint,boolean) from public,anon;
grant execute on function public.save_restaurant_appearance(uuid,jsonb,text,text,bigint,boolean) to authenticated,service_role;