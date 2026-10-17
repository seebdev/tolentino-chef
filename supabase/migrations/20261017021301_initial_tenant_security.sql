-- Tolentino: tenant isolation. Apply only to the dedicated NEW Supabase project.
-- No public database reads: menu responses must be projected by the server.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  public_token uuid not null unique default gen_random_uuid(),
  menu_version bigint not null default 1 check(menu_version > 0),
  menu_version_transaction bigint not null default 0,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 80),
  description text not null default '' check (char_length(description) <= 3000),
  status text not null default 'active' check (status in ('active','suspended')),
  owner_name text not null check (char_length(owner_name) between 1 and 120),
  owner_email text not null check (char_length(owner_email) between 3 and 254),
  phone text not null default '' check (char_length(phone) <= 40),
  currency text not null default 'COP' check (currency in ('USD','EUR','COP','MXN','PEN','CLP','ARS','BRL')),
  default_language text not null default 'es' check (default_language in ('es','en','fr','it','zh','ja','hi')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index restaurants_status_created_idx on public.restaurants(status,created_at desc);
create table public.restaurant_memberships (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete restrict,
  role text not null default 'owner' check (role = 'owner'),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.restaurant_settings (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  appearance jsonb not null default '{"primary":"#244b3b","secondary":"#efe8dc","font":"serif","logo_path":null,"cover_path":null,"favicon_path":null}'::jsonb check (jsonb_typeof(appearance) = 'object'),
  draft_appearance jsonb not null default '{"primary":"#244b3b","secondary":"#efe8dc","font":"serif","logo_path":null,"cover_path":null,"favicon_path":null}'::jsonb check (jsonb_typeof(draft_appearance) = 'object'),
  enabled_languages text[] not null default array['es','en'] check (
    cardinality(enabled_languages) between 1 and 7 and enabled_languages <@ array['es','en','fr','it','zh','ja','hi']),
  suspension_message text not null default 'Este menú no está disponible temporalmente.' check (char_length(suspension_message) <= 500),
  updated_at timestamptz not null default now()
);
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  parent_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  normalized_name text generated always as (lower(btrim(name))) stored,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(restaurant_id,id),
  foreign key(restaurant_id,parent_id) references public.categories(restaurant_id,id) on delete restrict,
  check (id is distinct from parent_id)
);
create index categories_tenant_sort_idx on public.categories(restaurant_id,sort_order);
create index categories_parent_idx on public.categories(restaurant_id,parent_id);
create unique index categories_normalized_name_idx on public.categories(restaurant_id,normalized_name);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  category_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  normalized_name text generated always as (lower(btrim(name))) stored,
  description text not null default '' check (char_length(description) <= 4000),
  price numeric(12,2) not null check (price >= 0 and price <= 9999999999.99),
  image_path text check (image_path is null or
    (split_part(image_path,'/',1) = restaurant_id::text and image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|avif)$')),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  ingredients text not null default '' check (char_length(ingredients) <= 3000),
  variants jsonb not null default '[]'::jsonb check (jsonb_typeof(variants) = 'array' and jsonb_array_length(variants) <= 50),
  extras jsonb not null default '[]'::jsonb check (jsonb_typeof(extras) = 'array' and jsonb_array_length(extras) <= 50),
  is_published boolean not null default false,
  is_available boolean not null default true,
  is_featured boolean not null default false,
  sort_order integer not null default 0,
  sku text check (sku is null or char_length(btrim(sku)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(restaurant_id,id),
  unique(restaurant_id,sku),
  foreign key(restaurant_id,category_id) references public.categories(restaurant_id,id) on delete restrict
);
create index products_tenant_category_sort_idx on public.products(restaurant_id,category_id,sort_order);
create index products_public_idx on public.products(restaurant_id,sort_order) where is_published;
create index products_normalized_name_idx on public.products(restaurant_id,category_id,normalized_name);
create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);
create index promotions_tenant_idx on public.promotions(restaurant_id);
create table public.restaurant_hours (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  day_of_week smallint not null check(day_of_week between 0 and 6),
  opens_at time,
  closes_at time,
  is_closed boolean not null default false,
  unique(restaurant_id,day_of_week),
  check (is_closed or (opens_at is not null and closes_at is not null and opens_at <> closes_at))
);
create table public.translations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  entity_type text not null check(entity_type in ('product','category')),
  entity_id uuid not null,
  product_id uuid generated always as (case when entity_type = 'product' then entity_id end) stored,
  category_id uuid generated always as (case when entity_type = 'category' then entity_id end) stored,
  language text not null check(language in ('es','en','fr','it','zh','ja','hi')),
  fields jsonb not null check(jsonb_typeof(fields) = 'object' and octet_length(fields::text) <= 16000),
  updated_at timestamptz not null default now(),
  unique(restaurant_id,entity_type,entity_id,language),
  foreign key(restaurant_id,product_id) references public.products(restaurant_id,id) on delete cascade,
  foreign key(restaurant_id,category_id) references public.categories(restaurant_id,id) on delete cascade
);
create index translations_product_idx on public.translations(restaurant_id,product_id);
create index translations_category_idx on public.translations(restaurant_id,category_id);
create table public.restaurant_qr_configs (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  foreground text not null default '#1c1917' check (foreground ~ '^#[0-9A-Fa-f]{6}$'),
  background text not null default '#ffffff' check (background ~ '^#[0-9A-Fa-f]{6}$'),
  frame text not null default 'simple' check(frame in ('none','simple','rounded')),
  label text not null default 'Escanea nuestro menú' check(char_length(label) <= 100),
  include_logo boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.restaurant_domains (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  hostname text not null unique check (hostname = lower(hostname) and char_length(hostname) <= 253 and hostname ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$'),
  verification_token uuid not null unique default gen_random_uuid(),
  status text not null default 'pending' check(status in ('pending','verified','failed')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'verified') = (verified_at is not null))
);
create index restaurant_domains_tenant_idx on public.restaurant_domains(restaurant_id);
create table public.commercial_sales (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null unique references public.restaurants(id) on delete restrict,
  sold_at timestamptz not null default now(),
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'COP' check(currency in ('USD','EUR','COP','MXN','PEN','CLP','ARS','BRL')),
  notes text not null default '' check(char_length(notes) <= 4000)
);
create index commercial_sales_tenant_idx on public.commercial_sales(restaurant_id,sold_at desc);
create table public.security_audit_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references public.restaurants(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 100),
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 8000),
  created_at timestamptz not null default now()
);
create index audit_tenant_time_idx on public.security_audit_events(restaurant_id,created_at desc);
create index audit_actor_idx on public.security_audit_events(actor_user_id);
create table public.visit_events (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  day date not null default current_date,
  visits bigint not null default 0 check(visits >= 0),
  qr_scans bigint not null default 0 check(qr_scans >= 0 and qr_scans <= visits),
  primary key(restaurant_id,day)
);
create table public.platform_settings (
  id boolean primary key default true check(id = true),
  contact_url text default null check (char_length(contact_url) <= 500 and contact_url ~ '^(https://|mailto:|tel:)'),
  contact_label text not null default 'Contactar a Tolentino' check (char_length(contact_label) between 1 and 100),
  updated_at timestamptz not null default now()
);
insert into public.platform_settings(id) values(true);
create table private.rate_limits (
  key text primary key check(char_length(key) between 1 and 250),
  window_started_at timestamptz not null,
  hits integer not null check(hits > 0)
);
alter table private.rate_limits enable row level security;

-- These two narrow definers only answer ownership questions, never return tenant data.
create function private.owns_restaurant(p_restaurant_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select (select auth.uid()) is not null and exists (
  select 1 from public.restaurant_memberships m
  where m.restaurant_id = p_restaurant_id and m.user_id = (select auth.uid()) and m.is_active
 );
$$;
create function private.can_manage_restaurant(p_restaurant_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select (select auth.uid()) is not null and exists (
  select 1 from public.restaurant_memberships m join public.restaurants r on r.id=m.restaurant_id
  where m.restaurant_id=p_restaurant_id and m.user_id=(select auth.uid()) and m.is_active and r.status='active'
 );
$$;
revoke all on function private.owns_restaurant(uuid),private.can_manage_restaurant(uuid) from public,anon;
grant execute on function private.owns_restaurant(uuid),private.can_manage_restaurant(uuid) to authenticated,service_role;

create function private.guard_restaurant_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
 if new.id is distinct from old.id or new.public_token is distinct from old.public_token then
  raise exception 'restaurant_identity_immutable' using errcode='23514';
 end if;
 if row(new.name,new.slug,new.description,new.phone,new.currency,new.default_language,new.status)
    is distinct from row(old.name,old.slug,old.description,old.phone,old.currency,old.default_language,old.status) then
  if old.menu_version_transaction<>txid_current() then
   new.menu_version=old.menu_version+1; new.menu_version_transaction=txid_current();
  end if;
 end if;
 new.updated_at=now(); return new;
end $$;
create trigger guard_restaurant_identity before update on public.restaurants for each row execute function private.guard_restaurant_identity();

create function private.guard_tenant_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
 if new.restaurant_id is distinct from old.restaurant_id then
  raise exception 'tenant_identity_immutable' using errcode='23514';
 end if;
 return new;
end $$;
create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at=now(); return new; end $$;
create function private.guard_category_tree() returns trigger
language plpgsql set search_path = '' as $$
begin
 -- Serialize tree edits inside one tenant, avoiding two concurrent A->B / B->A writes.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.restaurant_id::text,0));
 if new.parent_id is not null and exists (
  with recursive ancestors as (
    select id,parent_id from public.categories where restaurant_id=new.restaurant_id and id=new.parent_id
    union
    select c.id,c.parent_id from public.categories c join ancestors a on c.id=a.parent_id where c.restaurant_id=new.restaurant_id
  ) select 1 from ancestors where id=new.id
 ) then raise exception 'category_cycle' using errcode='23514'; end if;
 return new;
end $$;
create trigger guard_category_tree before insert or update on public.categories for each row execute function private.guard_category_tree();

do $$
declare t text;
begin
 foreach t in array array['platform_admins','restaurants','restaurant_memberships','restaurant_settings','categories','products','promotions','restaurant_hours','translations','restaurant_qr_configs','restaurant_domains','commercial_sales','security_audit_events','visit_events','platform_settings'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
 foreach t in array array['restaurant_memberships','restaurant_settings','categories','products','promotions','restaurant_hours','translations','restaurant_qr_configs','restaurant_domains'] loop
  execute format('create trigger guard_tenant_identity before update on public.%I for each row execute function private.guard_tenant_identity()',t);
 end loop;
 foreach t in array array['restaurant_settings','categories','products','promotions','translations','restaurant_qr_configs'] loop
  execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()',t);
 end loop;
 foreach t in array array['restaurant_settings','categories','products','promotions','restaurant_hours','translations'] loop
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  execute format('create policy tenant_select on public.%I for select to authenticated using ((select private.can_manage_restaurant(restaurant_id)))',t);
  execute format('create policy tenant_insert on public.%I for insert to authenticated with check ((select private.can_manage_restaurant(restaurant_id)))',t);
  execute format('create policy tenant_update on public.%I for update to authenticated using ((select private.can_manage_restaurant(restaurant_id))) with check ((select private.can_manage_restaurant(restaurant_id)))',t);
  execute format('create policy tenant_delete on public.%I for delete to authenticated using ((select private.can_manage_restaurant(restaurant_id)))',t);
 end loop;
end $$;
-- Owner can view status while suspended but cannot mutate restaurant status, owner assignment or QR token.
grant select on public.restaurants,public.restaurant_memberships,public.platform_admins,public.restaurant_domains,public.restaurant_qr_configs,public.visit_events to authenticated;
grant update(name,description,phone,currency,default_language) on public.restaurants to authenticated;
create policy owner_read_restaurant on public.restaurants for select to authenticated using ((select private.owns_restaurant(id)));
create policy owner_update_restaurant on public.restaurants for update to authenticated using ((select private.can_manage_restaurant(id))) with check ((select private.can_manage_restaurant(id)));
create policy own_membership on public.restaurant_memberships for select to authenticated using (user_id = (select auth.uid()));
create policy own_platform_role on public.platform_admins for select to authenticated using (user_id = (select auth.uid()));
create policy owner_read_qr on public.restaurant_qr_configs for select to authenticated using ((select private.can_manage_restaurant(restaurant_id)));
create policy owner_read_domain on public.restaurant_domains for select to authenticated using ((select private.can_manage_restaurant(restaurant_id)));
create policy owner_read_visits on public.visit_events for select to authenticated using ((select private.can_manage_restaurant(restaurant_id)));

-- Private bucket: suspended tenants and anonymous callers cannot read its objects.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('restaurant-media','restaurant-media',false,5242880,array['image/jpeg','image/png','image/webp','image/avif'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create function private.can_access_media(p_name text) returns boolean
language plpgsql stable security invoker set search_path = '' as $$
begin
 if p_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|avif)$' then return false; end if;
 return private.can_manage_restaurant(split_part(p_name,'/',1)::uuid);
exception when invalid_text_representation then return false;
end $$;
revoke all on function private.can_access_media(text) from public,anon;
grant execute on function private.can_access_media(text) to authenticated,service_role;
create policy tenant_media_select on storage.objects for select to authenticated
 using(bucket_id='restaurant-media' and (select private.can_access_media(name)));
create policy tenant_media_insert on storage.objects for insert to authenticated
 with check(bucket_id='restaurant-media' and (select private.can_access_media(name)));
create policy tenant_media_update on storage.objects for update to authenticated
 using(bucket_id='restaurant-media' and (select private.can_access_media(name)))
 with check(bucket_id='restaurant-media' and (select private.can_access_media(name)));
create policy tenant_media_delete on storage.objects for delete to authenticated
 using(bucket_id='restaurant-media' and (select private.can_access_media(name)));

-- The caller is service_role only. Auth user provisioning happens before this atomic database unit.
create function public.provision_restaurant(
 p_id uuid,p_owner_id uuid,p_name text,p_slug text,p_owner_name text,p_owner_email text,
 p_phone text default '',p_currency text default 'COP',p_default_language text default 'es',
 p_sale_amount numeric default 0,p_sale_currency text default 'COP',p_sale_notes text default '',
 p_description text default '',p_status text default 'active',p_sold_at timestamptz default now()
) returns uuid language plpgsql security invoker set search_path = '' as $$
begin
 insert into public.restaurants(id,name,slug,owner_name,owner_email,phone,currency,default_language,description,status)
 values(p_id,p_name,p_slug,p_owner_name,p_owner_email,p_phone,p_currency,p_default_language,p_description,p_status);
 insert into public.restaurant_memberships(restaurant_id,user_id) values(p_id,p_owner_id);
 insert into public.restaurant_settings(restaurant_id,enabled_languages) values(p_id,array[p_default_language]);
 insert into public.restaurant_qr_configs(restaurant_id) values(p_id);
 insert into public.restaurant_hours(restaurant_id,day_of_week,opens_at,closes_at)
 select p_id,day,'09:00'::time,'22:00'::time from generate_series(0,6) day;
 insert into public.commercial_sales(restaurant_id,amount,currency,notes,sold_at)
 values(p_id,p_sale_amount,p_sale_currency,p_sale_notes,coalesce(p_sold_at,now()));
 return p_id;
end $$;
revoke all on function public.provision_restaurant(uuid,uuid,text,text,text,text,text,text,text,numeric,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.provision_restaurant(uuid,uuid,text,text,text,text,text,text,text,numeric,text,text,text,text,timestamptz) to service_role;

grant select,insert,update,delete on private.rate_limits to service_role;
create function public.consume_rate_limit(p_key text,p_limit integer,p_window_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare used integer;
begin
 if p_limit < 1 or p_limit > 100000 or p_window_seconds < 1 or p_window_seconds > 86400 then
  raise exception 'invalid_rate_limit' using errcode='22023';
 end if;
 insert into private.rate_limits(key,window_started_at,hits) values(p_key,clock_timestamp(),1)
 on conflict(key) do update set
 hits=case when private.rate_limits.window_started_at + make_interval(secs=>p_window_seconds) <= clock_timestamp()
 then 1 else least(private.rate_limits.hits::bigint+1,2147483647)::integer end,
 window_started_at=case when private.rate_limits.window_started_at + make_interval(secs=>p_window_seconds) <= clock_timestamp()
 then clock_timestamp() else private.rate_limits.window_started_at end
 returning hits into used;
 return used <= p_limit;
end $$;
revoke all on function public.consume_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_rate_limit(text,integer,integer) to service_role;
create function public.record_menu_visit(p_restaurant_id uuid,p_day date default current_date,p_is_qr boolean default false)
returns void language plpgsql security invoker set search_path = '' as $$
begin
 if p_day <> current_date then raise exception 'invalid_visit_day'; end if;
 insert into public.visit_events(restaurant_id,day,visits,qr_scans)
 select id,p_day,1,case when p_is_qr then 1 else 0 end from public.restaurants where id=p_restaurant_id and status='active'
 on conflict(restaurant_id,day) do update set visits=public.visit_events.visits+1,qr_scans=public.visit_events.qr_scans+case when p_is_qr then 1 else 0 end;
end $$;
revoke all on function public.record_menu_visit(uuid,date,boolean) from public,anon,authenticated;
grant execute on function public.record_menu_visit(uuid,date,boolean) to service_role;

-- CSV import is one transaction; any invalid row rolls back categories and all product writes.
create function public.import_products(p_restaurant_id uuid,p_rows jsonb,p_mode text default 'skip',p_create_categories boolean default false)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 row_data jsonb; category_key text; category_uuid uuid; matches uuid[]; matched_id uuid;
 product_name text; product_sku text; item_price numeric; inserted_count integer=0; updated_count integer=0;
 skipped_count integer=0; categories_count integer=0;
begin
 if p_mode is null or p_rows is null or p_create_categories is null or p_mode not in ('skip','update') or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 1000 then
  raise exception 'invalid_import_request' using errcode='22023';
 end if;
 -- RLS enforces the caller's actual membership; this also denies suspended tenants even to service imports.
 perform 1 from public.restaurants where id=p_restaurant_id and status='active' for update;
 if not found then raise exception 'restaurant_unavailable' using errcode='42501'; end if;
 if current_user <> 'service_role' and not private.can_manage_restaurant(p_restaurant_id) then
  raise exception 'tenant_access_denied' using errcode='42501';
 end if;
 for row_data in select value from jsonb_array_elements(p_rows) loop
  product_name=btrim(row_data->>'name'); product_sku=nullif(btrim(row_data->>'sku'),'');
  category_key=btrim(row_data->>'category');
  if product_name is null or product_name='' or category_key is null or category_key='' or row_data->>'price' is null then
   raise exception 'invalid_import_row' using errcode='22023';
  end if;
  item_price=(row_data->>'price')::numeric;
  if item_price < 0 or item_price > 9999999999.99 or item_price::text in ('NaN','Infinity','-Infinity') then
   raise exception 'invalid_product_price' using errcode='22023';
  end if;
  select id into category_uuid from public.categories where restaurant_id=p_restaurant_id and normalized_name=lower(category_key);
  if category_uuid is null then
   if not p_create_categories then raise exception 'category_not_found: %',category_key using errcode='22023'; end if;
   insert into public.categories(restaurant_id,name) values(p_restaurant_id,category_key) returning id into category_uuid;
   categories_count=categories_count+1;
  end if;
  if product_sku is not null then
   select array_agg(id) into matches from public.products
    where restaurant_id=p_restaurant_id and sku=product_sku;
  else
   select array_agg(id) into matches from public.products
    where restaurant_id=p_restaurant_id and category_id=category_uuid and normalized_name=lower(product_name);
  end if;
  if cardinality(matches)>1 then raise exception 'ambiguous_duplicate: %',product_name using errcode='22023'; end if;
  matched_id=matches[1];
  if matched_id is not null and p_mode='skip' then skipped_count=skipped_count+1; continue; end if;
  if matched_id is null then
   insert into public.products(restaurant_id,category_id,name,description,price,sku,image_path,tags,ingredients,variants,extras,is_published,is_available,is_featured,sort_order)
   values(p_restaurant_id,category_uuid,product_name,coalesce(row_data->>'description',''),item_price,product_sku,nullif(row_data->>'image_path',''),
    case when row_data ? 'tags' then array(select jsonb_array_elements_text(row_data->'tags')) else '{}' end,
    coalesce(row_data->>'ingredients',''),coalesce(row_data->'variants','[]'),coalesce(row_data->'extras','[]'),
    coalesce((row_data->>'is_published')::boolean,false),coalesce((row_data->>'is_available')::boolean,true),
    coalesce((row_data->>'is_featured')::boolean,false),coalesce((row_data->>'sort_order')::integer,0));
   inserted_count=inserted_count+1;
  else
   update public.products set category_id=category_uuid,name=product_name,price=item_price,
    sku=case when row_data ? 'sku' then product_sku else sku end,
    description=coalesce(row_data->>'description',description),
    image_path=case when row_data ? 'image_path' then nullif(row_data->>'image_path','') else image_path end,
    tags=case when row_data ? 'tags' then array(select jsonb_array_elements_text(row_data->'tags')) else tags end,
    ingredients=coalesce(row_data->>'ingredients',ingredients),
    variants=coalesce(row_data->'variants',variants),extras=coalesce(row_data->'extras',extras),
    is_published=coalesce((row_data->>'is_published')::boolean,is_published),
    is_available=coalesce((row_data->>'is_available')::boolean,is_available),
    is_featured=coalesce((row_data->>'is_featured')::boolean,is_featured),
    sort_order=coalesce((row_data->>'sort_order')::integer,sort_order)
   where restaurant_id=p_restaurant_id and id=matched_id;
   updated_count=updated_count+1;
  end if;
 end loop;
 return jsonb_build_object('inserted',inserted_count,'updated',updated_count,'skipped',skipped_count,'categories_created',categories_count);
end $$;
revoke all on function public.import_products(uuid,jsonb,text,boolean) from public,anon;
grant execute on function public.import_products(uuid,jsonb,text,boolean) to authenticated,service_role;

-- Trigger functions are not RPC endpoints and should not be executable by API roles.
revoke all on function private.guard_restaurant_identity(),private.guard_tenant_identity(),private.touch_updated_at(),private.guard_category_tree() from public,anon,authenticated;

-- Invalidate once per transaction on any relevant mutation, including deletes and translations.
-- A cache reader cannot observe uncommitted changes, so one version per committed unit suffices.
-- Definer privilege is needed because owners cannot set menu_version directly.
create function private.bump_menu_version() returns trigger
language plpgsql security definer set search_path = '' as $$
declare tenant_id uuid;
begin
 tenant_id=case when tg_op='DELETE' then old.restaurant_id else new.restaurant_id end;
 if (select auth.uid()) is not null and not private.can_manage_restaurant(tenant_id)
 then raise exception 'tenant_access_denied' using errcode='42501'; end if;
 update public.restaurants set menu_version=menu_version+1,menu_version_transaction=txid_current()
 where id=tenant_id and menu_version_transaction<>txid_current();
 return null;
end $$;
revoke all on function private.bump_menu_version() from public,anon,authenticated;
do $$
declare t text;
begin
 foreach t in array array['restaurant_settings','categories','products','promotions','restaurant_hours','translations','restaurant_qr_configs','restaurant_domains'] loop
 execute format('create trigger bump_menu_version after insert or update or delete on public.%I for each row execute function private.bump_menu_version()',t);
 end loop;
end $$;

-- Transactional platform edit: the existing Auth email is deliberately excluded.
create function public.update_restaurant(p_id uuid,p_data jsonb,p_sale jsonb default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
begin
 if p_data is null or jsonb_typeof(p_data)<>'object' or exists(
  select 1 from jsonb_object_keys(p_data) k where k not in ('name','slug','description','owner_name','phone','currency','default_language','status')
 ) then raise exception 'invalid_restaurant_update' using errcode='22023'; end if;
 update public.restaurants set
 name=case when p_data ? 'name' then p_data->>'name' else name end,
 slug=case when p_data ? 'slug' then p_data->>'slug' else slug end,
 description=case when p_data ? 'description' then p_data->>'description' else description end,
 owner_name=case when p_data ? 'owner_name' then p_data->>'owner_name' else owner_name end,
 phone=case when p_data ? 'phone' then p_data->>'phone' else phone end,
 currency=case when p_data ? 'currency' then p_data->>'currency' else currency end,
 default_language=case when p_data ? 'default_language' then p_data->>'default_language' else default_language end,
 status=case when p_data ? 'status' then p_data->>'status' else status end
 where id=p_id;
 if not found then raise exception 'restaurant_not_found' using errcode='P0002'; end if;
 if p_sale is not null and p_sale <> 'null'::jsonb then
  if jsonb_typeof(p_sale)<>'object' or exists(
   select 1 from jsonb_object_keys(p_sale) k where k not in ('sold_at','amount','currency','notes')
  ) then raise exception 'invalid_sale_update' using errcode='22023'; end if;
  update public.commercial_sales set
   sold_at=coalesce((p_sale->>'sold_at')::timestamptz,sold_at),
   amount=case when p_sale ? 'amount' then (p_sale->>'amount')::numeric else amount end,
   currency=case when p_sale ? 'currency' then p_sale->>'currency' else currency end,
   notes=case when p_sale ? 'notes' then p_sale->>'notes' else notes end
   where restaurant_id=p_id;
  if not found then raise exception 'commercial_sale_not_found' using errcode='P0002'; end if;
 end if;
 return p_id;
end $$;
revoke all on function public.update_restaurant(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.update_restaurant(uuid,jsonb,jsonb) to service_role;

create function public.save_restaurant_languages(p_restaurant_id uuid,p_default_language text,p_enabled_languages text[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
 if p_default_language is null or p_enabled_languages is null or not (p_default_language=any(p_enabled_languages)) then
  raise exception 'default_language_must_be_enabled' using errcode='22023';
 end if;
 update public.restaurants set default_language=p_default_language where id=p_restaurant_id and status='active';
 if not found then raise exception 'restaurant_unavailable' using errcode='42501'; end if;
 update public.restaurant_settings set enabled_languages=p_enabled_languages where restaurant_id=p_restaurant_id;
 if not found then raise exception 'restaurant_settings_unavailable' using errcode='42501'; end if;
end $$;
revoke all on function public.save_restaurant_languages(uuid,text,text[]) from public,anon;
grant execute on function public.save_restaurant_languages(uuid,text,text[]) to authenticated,service_role;

-- Defense in depth for callers using PostgREST directly rather than the validated app API.
create function private.valid_appearance(p_value jsonb,p_restaurant_id uuid)
returns boolean language sql immutable security invoker set search_path = '' as $$
 select jsonb_typeof(p_value)='object' and octet_length(p_value::text)<=8000 and not exists (
  select 1 from jsonb_each(p_value) e where
   e.key not in ('primary','secondary','font','logo_path','cover_path','favicon_path')
   or (e.key in ('primary','secondary') and (jsonb_typeof(e.value)<>'string' or (e.value#>>'{}') !~ '^#[0-9A-Fa-f]{6}$'))
   or (e.key='font' and (jsonb_typeof(e.value)<>'string' or (e.value#>>'{}') not in ('serif','sans','rounded')))
   or (e.key in ('logo_path','cover_path','favicon_path') and e.value<>'null'::jsonb and
     (jsonb_typeof(e.value)<>'string' or split_part(e.value#>>'{}','/',1)<>p_restaurant_id::text
      or (e.value#>>'{}') !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|avif)$'))
 );
$$;
revoke all on function private.valid_appearance(jsonb,uuid) from public,anon;
grant execute on function private.valid_appearance(jsonb,uuid) to authenticated,service_role;
alter table public.restaurant_settings add constraint valid_published_appearance check(private.valid_appearance(appearance,restaurant_id));
alter table public.restaurant_settings add constraint valid_draft_appearance check(private.valid_appearance(draft_appearance,restaurant_id));

-- Aggregate in PostgreSQL; fetching daily rows through PostgREST would truncate at max_rows.
create function public.admin_stats() returns jsonb
language sql stable security invoker set search_path = '' as $$
 select jsonb_build_object(
 'total',(select count(*) from public.restaurants),
 'active',(select count(*) from public.restaurants where status='active'),
 'suspended',(select count(*) from public.restaurants where status='suspended'),
 'products',(select count(*) from public.products),
 'publishedProducts',(select count(*) from public.products where is_published),
 'qr_generated',(select count(*) from public.restaurant_qr_configs),
 'visits',(select coalesce(sum(visits),0) from public.visit_events),
 'scans',(select coalesce(sum(qr_scans),0) from public.visit_events),
 'issues',(select count(*) from public.restaurant_domains where status<>'verified'),
 'sales_by_currency',(select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'total',total,'count',sales_count) order by currency),'[]'::jsonb)
   from (select currency,sum(amount) total,count(*) sales_count from public.commercial_sales group by currency) sales)
 );
$$;
revoke all on function public.admin_stats() from public,anon,authenticated;
grant execute on function public.admin_stats() to service_role;

create function public.restaurant_stats(p_restaurant_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
 if current_user <> 'service_role' and not private.can_manage_restaurant(p_restaurant_id) then
  raise exception 'tenant_access_denied' using errcode='42501';
 end if;
 return jsonb_build_object(
 'products',(select count(*) from public.products where restaurant_id=p_restaurant_id),
 'published',(select count(*) from public.products where restaurant_id=p_restaurant_id and is_published),
 'categories',(select count(*) from public.categories where restaurant_id=p_restaurant_id),
 'visits',(select coalesce(sum(visits),0) from public.visit_events where restaurant_id=p_restaurant_id),
 'scans',(select coalesce(sum(qr_scans),0) from public.visit_events where restaurant_id=p_restaurant_id)
 );
end $$;
revoke all on function public.restaurant_stats(uuid) from public,anon;
grant execute on function public.restaurant_stats(uuid) to authenticated,service_role;

-- Global support copy is loaded fresh for suspended public menus.
alter table public.platform_settings add column suspension_message text not null
 default 'Este menú no está disponible temporalmente.'
 check(char_length(btrim(suspension_message)) between 1 and 500);
