import fs from 'node:fs';
import {targetEnvironment} from './migration-target-inspect.mjs';
import {connectTargetPg} from './migration-target-runtime.mjs';
const db=await connectTargetPg(targetEnvironment());
try{
 const restaurants=(await db.query("select r.id,r.name,r.slug,r.is_demo,r.status,s.enabled_languages,(select count(*)::int from public.products p where p.restaurant_id=r.id) as products,(select count(*)::int from public.translations t where t.restaurant_id=r.id) as translations from public.restaurants r join public.restaurant_settings s on s.restaurant_id=r.id order by r.id")).rows;
 const coverage=(await db.query("select t.entity_type,t.language,count(*)::int as count,count(*)filter(where t.is_manual)::int as manual,count(*)filter(where coalesce(t.fields->>'name','')=coalesce(p.name,c.name,'') and (p.id is not null or c.id is not null))::int as same_name_source from public.translations t left join public.products p on t.entity_type='product' and t.entity_id=p.id and t.restaurant_id=p.restaurant_id left join public.categories c on t.entity_type='category' and t.entity_id=c.id and t.restaurant_id=c.restaurant_id group by 1,2 order by 1,2")).rows;
 const examples=(await db.query("select t.language,p.name as source,t.fields from public.translations t join public.products p on p.id=t.entity_id and p.restaurant_id=t.restaurant_id where t.entity_type='product' and t.language='en' order by t.id limit 4")).rows;
 const report={at:new Date().toISOString(),restaurants,coverage,examples};fs.writeFileSync('docs/evidence/functional-closure-20261018/catalog-before-translations.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await db.end()}