-- A stale editor/import/lease is a terminal business conflict, not a serialization failure.
-- PostgREST 14 retries SQLSTATE 40001; PT409 returns the intended HTTP 409 immediately.
-- Reference: https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
-- Only changes the error code; identities, permissions and all stored rows remain unchanged.
do $$
declare item record; definition text; found_count integer:=0;
begin
 for item in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in('import_products_attempt','save_qr_configuration','save_restaurant_appearance','complete_restaurant_creation')
 loop
  definition=pg_get_functiondef(item.oid);
  if position('''40001''' in definition)=0 then raise exception 'conflict_definition_changed'; end if;
  execute replace(definition,'''40001''','''PT409''');
  found_count=found_count+1;
 end loop;
 if found_count=0 then raise exception 'conflict_functions_missing'; end if;
end $$;