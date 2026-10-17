import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const UA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADMIN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CAT_A = "11111111-1111-4111-8111-111111111112";
const CAT_B = "22222222-2222-4222-8222-222222222223";
const PROD_A = "11111111-1111-4111-8111-111111111113";
const PROD_B = "22222222-2222-4222-8222-222222222224";
let db: PGlite;
const benchmarks: { rows: number; milliseconds: number; rejected?: boolean }[] =
  [];

// PostgreSQL runs inside PGlite. Auth and Storage schemas below are minimal stand-ins;
// these tests do NOT claim to exercise GoTrue, PostgREST or the Storage HTTP service.
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;" +
      "create schema auth; create schema storage; grant usage on schema public,auth,storage to anon,authenticated,service_role;" +
      "create table auth.users(id uuid primary key);" +
      "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;" +
      "create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);" +
      "create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,unique(bucket_id,name));" +
      "alter table storage.objects enable row level security; grant all on storage.objects to authenticated,service_role;",
  );
  const migrations = resolve(process.cwd(), "supabase/migrations");
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await db.exec(
      readFileSync(resolve(migrations, file), "utf8").replace(/^\uFEFF/, ""),
    );
  }
  await db.query("insert into auth.users(id) values($1),($2),($3)", [
    UA,
    UB,
    ADMIN,
  ]);
  await db.exec("set role service_role");
  for (const [id, user, name, slug] of [
    [A, UA, "Restaurant A", "restaurant-a"],
    [B, UB, "Restaurant B", "restaurant-b"],
  ]) {
    await db.query(
      "select public.provision_restaurant($1,$2,$3,$4,'Owner','owner@example.test')",
      [id, user, name, slug],
    );
  }
  await db.query("insert into public.platform_admins(user_id) values($1)", [
    ADMIN,
  ]);
  await db.query(
    "insert into public.categories(id,restaurant_id,name) values($1,$2,'Main'),($3,$4,'Main')",
    [CAT_A, A, CAT_B, B],
  );
  await db.query(
    "insert into public.products(id,restaurant_id,category_id,name,price,sku,is_published) values($1,$2,$3,'A dish',10,'A1',true),($4,$5,$6,'B secret',20,'B1',true)",
    [PROD_A, A, CAT_A, PROD_B, B, CAT_B],
  );
  await db.query(
    "insert into storage.objects(bucket_id,name) values('restaurant-media',$1),('restaurant-media',$2)",
    [A + "/" + PROD_A + ".webp", B + "/" + PROD_B + ".webp"],
  );
  await db.exec("reset role");
}, 60000);
afterAll(async () => {
  if (benchmarks.length) {
    mkdirSync("test-results", { recursive: true });
    writeFileSync(
      "test-results/database-benchmarks.json",
      JSON.stringify(
        {
          engine: "PostgreSQL PGlite",
          node: process.version,
          measuredAt: new Date().toISOString(),
          benchmarks,
        },
        null,
        2,
      ),
    );
  }
  await db?.close();
});

async function asRole(
  role: "anon" | "authenticated" | "service_role",
  user: string | null,
  run: () => Promise<void>,
) {
  await db.exec("begin");
  try {
    await db.exec("set local role " + role);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user ?? "",
    ]);
    await run();
  } finally {
    await db.exec("rollback");
  }
}
async function denied(sql: string, params: unknown[] = []) {
  await db.exec("savepoint denial");
  let error: unknown;
  try {
    await db.query(sql, params);
  } catch (caught) {
    error = caught;
  }
  await db.exec("rollback to savepoint denial");
  expect(
    error,
    "Operation should have been rejected by PostgreSQL",
  ).toBeTruthy();
}
async function rows(sql: string, params: unknown[] = []) {
  return (await db.query(sql, params)).rows;
}
async function scalar(sql: string, params: unknown[] = []) {
  const row = (await rows(sql, params))[0];
  return Object.values(row ?? {})[0];
}

describe.sequential(
  "PostgreSQL tenant isolation, constraints and transactional operations",
  () => {
    it("enables RLS on every application table and exposes no anonymous read grants", async () => {
      const tables = await rows(
        "select tablename from pg_tables where schemaname='public' and not rowsecurity",
      );
      expect(tables).toEqual([]);
      expect(
        await scalar(
          "select public from storage.buckets where id='restaurant-media'",
        ),
      ).toBe(false);
      expect(
        await scalar(
          "select has_table_privilege('anon','public.products','select')",
        ),
      ).toBe(false);
      expect(
        await scalar(
          "select has_function_privilege('anon','public.import_products(uuid,jsonb,text,boolean)','execute')",
        ),
      ).toBe(false);
      expect(
        await scalar(
          "select has_function_privilege('authenticated','public.provision_restaurant(uuid,uuid,text,text,text,text,text,text,text,numeric,text,text,text,text,timestamptz)','execute')",
        ),
      ).toBe(false);
    });
    it("anonymous visitors cannot read database tables or call privileged operations", () =>
      asRole("anon", null, async () => {
        await denied("select * from public.restaurants");
        await denied("select * from public.products");
        await denied("select public.consume_rate_limit('anon',3,60)");
        await denied("select public.record_menu_visit($1)", [A]);
      }));
    it("owner A sees only A, and owner B sees only B", async () => {
      await asRole("authenticated", UA, async () => {
        expect(await rows("select name from public.products")).toEqual([
          { name: "A dish" },
        ]);
        expect(await rows("select id from public.restaurants")).toEqual([
          { id: A },
        ]);
        expect(
          await rows("select user_id from public.restaurant_memberships"),
        ).toEqual([{ user_id: UA }]);
        expect(await rows("select * from public.platform_admins")).toEqual([]);
      });
      await asRole("authenticated", UB, async () => {
        expect(await rows("select name from public.products")).toEqual([
          { name: "B secret" },
        ]);
      });
    });
    it("an authenticated platform admin has no global database bypass", () =>
      asRole("authenticated", ADMIN, async () => {
        expect(
          await rows("select user_id from public.platform_admins"),
        ).toEqual([{ user_id: ADMIN }]);
        expect(await rows("select * from public.products")).toEqual([]);
        expect(await rows("select * from public.restaurants")).toEqual([]);
        await denied(
          "insert into public.categories(restaurant_id,name) values($1,'attack')",
          [A],
        );
      }));
    it("owners can mutate their own menu but cannot read, update, delete or insert in another tenant", () =>
      asRole("authenticated", UA, async () => {
        expect(
          await rows(
            "update public.products set price=12 where id=$1 returning price",
            [PROD_A],
          ),
        ).toHaveLength(1);
        expect(
          await rows(
            "update public.products set price=999 where id=$1 returning id",
            [PROD_B],
          ),
        ).toEqual([]);
        expect(
          await rows("delete from public.products where id=$1 returning id", [
            PROD_B,
          ]),
        ).toEqual([]);
        await denied(
          "insert into public.products(restaurant_id,category_id,name,price) values($1,$2,'attack',1)",
          [B, CAT_B],
        );
        await denied(
          "update public.products set restaurant_id=$1 where id=$2",
          [B, PROD_A],
        );
      }));
    it("composite foreign keys reject cross-tenant products, subcategories and translations", () =>
      asRole("authenticated", UA, async () => {
        await denied(
          "insert into public.products(restaurant_id,category_id,name,price) values($1,$2,'cross',1)",
          [A, CAT_B],
        );
        await denied(
          "insert into public.categories(restaurant_id,parent_id,name) values($1,$2,'cross')",
          [A, CAT_B],
        );
        await denied(
          "insert into public.translations(restaurant_id,entity_type,entity_id,language,fields) values($1,'product',$2,'en','{}')",
          [A, PROD_B],
        );
        await denied(
          "insert into public.translations(restaurant_id,entity_type,entity_id,language,fields) values($1,'category',$2,'en','{}')",
          [A, CAT_B],
        );
      }));
    it("owners cannot promote themselves, change membership, reactivate status or forge domain verification", () =>
      asRole("authenticated", UA, async () => {
        await denied("insert into public.platform_admins(user_id) values($1)", [
          UA,
        ]);
        await denied(
          "update public.restaurant_memberships set user_id=$1 where restaurant_id=$2",
          [ADMIN, A],
        );
        await denied(
          "update public.restaurants set status='active' where id=$1",
          [A],
        );
        await denied(
          "insert into public.restaurant_domains(restaurant_id,hostname,status,verified_at) values($1,'attacker.example','verified',now())",
          [A],
        );
        await denied(
          "insert into public.commercial_sales(restaurant_id,amount) values($1,100)",
          [A],
        );
        await denied(
          "insert into public.security_audit_events(action) values('forged')",
        );
      }));
    it("public token is immutable even to service role", () =>
      asRole("service_role", null, async () => {
        await denied(
          "update public.restaurants set public_token=gen_random_uuid() where id=$1",
          [A],
        );
      }));
    it("private media enforces tenant paths and rejects movement across restaurants", () =>
      asRole("authenticated", UA, async () => {
        expect(await rows("select name from storage.objects")).toEqual([
          { name: A + "/" + PROD_A + ".webp" },
        ]);
        await denied(
          "insert into storage.objects(bucket_id,name) values('restaurant-media',$1)",
          [B + "/33333333-3333-4333-8333-333333333333.png"],
        );
        await denied("update storage.objects set name=$1 where name=$2", [
          B + "/" + PROD_A + ".webp",
          A + "/" + PROD_A + ".webp",
        ]);
        await denied(
          "insert into storage.objects(bucket_id,name) values('restaurant-media','invalid/../../secret.png')",
        );
      }));
    it("suspension denies menu and media while leaving owner status visible", () =>
      asRole("service_role", null, async () => {
        await db.query(
          "update public.restaurants set status='suspended' where id=$1",
          [A],
        );
        await db.exec("set local role authenticated");
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
          UA,
        ]);
        expect(await rows("select status from public.restaurants")).toEqual([
          { status: "suspended" },
        ]);
        expect(await rows("select * from public.products")).toEqual([]);
        expect(await rows("select * from storage.objects")).toEqual([]);
        await denied(
          "insert into public.categories(restaurant_id,name) values($1,'blocked')",
          [A],
        );
        await denied(
          "select public.import_products($1,$2::jsonb,'skip',true)",
          [A, JSON.stringify([{ name: "blocked", category: "New", price: 1 }])],
        );
      }));
    it("disabled membership remains inspectable but revokes all business access immediately", () =>
      asRole("service_role", null, async () => {
        await db.query(
          "update public.restaurant_memberships set is_active=false where restaurant_id=$1",
          [A],
        );
        await db.exec("set local role authenticated");
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
          UA,
        ]);
        expect(
          await rows("select is_active from public.restaurant_memberships"),
        ).toEqual([{ is_active: false }]);
        expect(await rows("select * from public.restaurants")).toEqual([]);
        expect(await rows("select * from public.products")).toEqual([]);
      }));
    it("imports create, update and skip exact SKU or normalized-name duplicates", () =>
      asRole("authenticated", UA, async () => {
        const first = [
          {
            name: " New Dish ",
            category: " New category ",
            price: 14,
            sku: "N1",
            is_published: true,
          },
        ];
        expect(
          await scalar(
            "select public.import_products($1,$2::jsonb,'skip',true)",
            [A, JSON.stringify(first)],
          ),
        ).toEqual({
          inserted: 1,
          updated: 0,
          skipped: 0,
          categories_created: 1,
        });
        expect(
          await scalar(
            "select public.import_products($1,$2::jsonb,'skip',false)",
            [A, JSON.stringify(first)],
          ),
        ).toEqual({
          inserted: 0,
          updated: 0,
          skipped: 1,
          categories_created: 0,
        });
        expect(
          await scalar(
            "select public.import_products($1,$2::jsonb,'update',false)",
            [
              A,
              JSON.stringify([
                {
                  name: "new dish",
                  category: "new category",
                  price: 18,
                  sku: "N1",
                },
              ]),
            ],
          ),
        ).toEqual({
          inserted: 0,
          updated: 1,
          skipped: 0,
          categories_created: 0,
        });
        expect(
          await scalar(
            "select price::text from public.products where sku='N1'",
          ),
        ).toBe("18.00");
        expect(
          await scalar(
            "select is_published from public.products where sku='N1'",
          ),
        ).toBe(true);
      }));
    it("a bad CSV row rolls back every earlier product and newly created category", () =>
      asRole("authenticated", UA, async () => {
        await denied(
          "select public.import_products($1,$2::jsonb,'skip',true)",
          [
            A,
            JSON.stringify([
              { name: "First", category: "Rolled Back", price: 3 },
              { name: "Bad", category: "Main", price: -1 },
            ]),
          ],
        );
        expect(
          await rows("select * from public.products where name='First'"),
        ).toEqual([]);
        expect(
          await rows(
            "select * from public.categories where name='Rolled Back'",
          ),
        ).toEqual([]);
      }));
    it("duplicate identity ambiguity is rejected without mutating either record", () =>
      asRole("authenticated", UA, async () => {
        await db.query(
          "insert into public.products(restaurant_id,category_id,name,price,sku) values($1,$2,'A dish',7,'A2')",
          [A, CAT_A],
        );
        await denied(
          "select public.import_products($1,$2::jsonb,'update',false)",
          [
            A,
            JSON.stringify([{ name: "A dish", category: "Main", price: 88 }]),
          ],
        );
        expect(
          await scalar("select price::text from public.products where id=$1", [
            PROD_A,
          ]),
        ).toBe("10.00");
      }));
    it("owner cannot import into B, even with a valid B restaurant ID", () =>
      asRole("authenticated", UA, async () => {
        await denied(
          "select public.import_products($1,$2::jsonb,'skip',true)",
          [B, JSON.stringify([{ name: "attack", category: "Main", price: 1 }])],
        );
      }));
    it("database constraints reject negative prices, invalid languages, cyclic category trees and unsafe image paths", () =>
      asRole("authenticated", UA, async () => {
        await denied("update public.products set price=-1 where id=$1", [
          PROD_A,
        ]);
        await denied("update public.products set image_path=$1 where id=$2", [
          B + "/" + PROD_B + ".webp",
          PROD_A,
        ]);
        await denied(
          "update public.restaurant_settings set enabled_languages=array['xx'] where restaurant_id=$1",
          [A],
        );
        const child = "33333333-3333-4333-8333-333333333333";
        await db.query(
          "insert into public.categories(id,restaurant_id,parent_id,name) values($1,$2,$3,'Child')",
          [child, A, CAT_A],
        );
        await denied("update public.categories set parent_id=$1 where id=$2", [
          child,
          CAT_A,
        ]);
      }));
    it("changes to products, settings and translations bump menu version", () =>
      asRole("authenticated", UA, async () => {
        const before = Number(
          await scalar(
            "select menu_version from public.restaurants where id=$1",
            [A],
          ),
        );
        await db.query(
          "update public.products set name='Revised' where id=$1",
          [PROD_A],
        );
        await db.query(
          'update public.restaurant_settings set appearance=\'{"primary":"#000000"}\' where restaurant_id=$1',
          [A],
        );
        await db.query(
          "insert into public.translations(restaurant_id,entity_type,entity_id,language,fields) values($1,'product',$2,'en','{\"name\":\"Revised\"}')",
          [A, PROD_A],
        );
        expect(
          Number(
            await scalar(
              "select menu_version from public.restaurants where id=$1",
              [A],
            ),
          ),
        ).toBe(before + 1);
        await denied(
          "update public.restaurants set menu_version=1 where id=$1",
          [A],
        );
      }));
    it("provisioning is atomic when owner assignment conflicts", () =>
      asRole("service_role", null, async () => {
        const newId = "44444444-4444-4444-8444-444444444444";
        await denied(
          "select public.provision_restaurant($1,$2,'No ghost','no-ghost','Owner','test@example.test')",
          [newId, UA],
        );
        expect(
          await rows("select * from public.restaurants where id=$1", [newId]),
        ).toEqual([]);
        expect(
          await rows(
            "select * from public.commercial_sales where restaurant_id=$1",
            [newId],
          ),
        ).toEqual([]);
      }));
    it("service role rate limiting counts across calls and rejects after the configured limit", () =>
      asRole("service_role", null, async () => {
        expect(
          await scalar("select public.consume_rate_limit('test:rate',2,60)"),
        ).toBe(true);
        expect(
          await scalar("select public.consume_rate_limit('test:rate',2,60)"),
        ).toBe(true);
        expect(
          await scalar("select public.consume_rate_limit('test:rate',2,60)"),
        ).toBe(false);
        await db.exec(
          "update private.rate_limits set window_started_at=now()-interval '61 seconds' where key='test:rate'",
        );
        expect(
          await scalar("select public.consume_rate_limit('test:rate',2,60)"),
        ).toBe(true);
      }));
    it("aggregate visits count QR scans separately and stop for suspended restaurants", () =>
      asRole("service_role", null, async () => {
        await db.query(
          "select public.record_menu_visit($1,current_date,true)",
          [A],
        );
        await db.query(
          "select public.record_menu_visit($1,current_date,false)",
          [A],
        );
        expect(
          await rows(
            "select visits::int,qr_scans::int from public.visit_events where restaurant_id=$1",
            [A],
          ),
        ).toEqual([{ visits: 2, qr_scans: 1 }]);
        await db.query(
          "update public.restaurants set status='suspended' where id=$1",
          [A],
        );
        await db.query("select public.record_menu_visit($1)", [A]);
        expect(
          Number(
            await scalar(
              "select visits from public.visit_events where restaurant_id=$1",
              [A],
            ),
          ),
        ).toBe(2);
      }));

    it("owners cannot edit platform-controlled slug or QR configuration", () =>
      asRole("authenticated", UA, async () => {
        await denied(
          "update public.restaurants set slug='hijacked' where id=$1",
          [A],
        );
        await denied(
          "update public.restaurant_qr_configs set foreground='#ff0000' where restaurant_id=$1",
          [A],
        );
        await denied(
          'select public.update_restaurant($1,\'{"status":"suspended"}\'::jsonb)',
          [A],
        );
      }));
    it("restaurant and sale edits commit together and reject protected properties", () =>
      asRole("service_role", null, async () => {
        await db.query(
          "select public.update_restaurant($1,$2::jsonb,$3::jsonb)",
          [
            A,
            JSON.stringify({ name: "Updated A", slug: "updated-a" }),
            JSON.stringify({
              amount: 125,
              currency: "COP",
              notes: "Updated sale",
            }),
          ],
        );
        expect(
          await scalar("select name from public.restaurants where id=$1", [A]),
        ).toBe("Updated A");
        expect(
          await scalar(
            "select amount::text from public.commercial_sales where restaurant_id=$1",
            [A],
          ),
        ).toBe("125.00");
        await denied(
          "select public.update_restaurant($1,$2::jsonb,$3::jsonb)",
          [
            A,
            JSON.stringify({ name: "Should roll back" }),
            JSON.stringify({ amount: -1 }),
          ],
        );
        expect(
          await scalar("select name from public.restaurants where id=$1", [A]),
        ).toBe("Updated A");
        await denied(
          'select public.update_restaurant($1,\'{"owner_email":"attacker@example.test"}\'::jsonb)',
          [A],
        );
        await denied(
          'select public.update_restaurant($1,\'{"public_token":"11111111-1111-4111-8111-111111111111"}\'::jsonb)',
          [A],
        );
      }));
    it("language changes validate enabled/default together and roll back invalid settings", () =>
      asRole("authenticated", UA, async () => {
        await db.query(
          "select public.save_restaurant_languages($1,'en',array['es','en'])",
          [A],
        );
        expect(
          await scalar(
            "select default_language from public.restaurants where id=$1",
            [A],
          ),
        ).toBe("en");
        expect(
          await scalar(
            "select enabled_languages from public.restaurant_settings where restaurant_id=$1",
            [A],
          ),
        ).toEqual(["es", "en"]);
        await denied(
          "select public.save_restaurant_languages($1,'fr',array['es','en'])",
          [A],
        );
        await denied(
          "select public.save_restaurant_languages($1,'fr',array['fr','xx'])",
          [A],
        );
        expect(
          await scalar(
            "select default_language from public.restaurants where id=$1",
            [A],
          ),
        ).toBe("en");
        await denied(
          "select public.save_restaurant_languages($1,'en',array['es','en'])",
          [B],
        );
      }));
    it("reactivation restores owner menu and media access without changing QR identity", () =>
      asRole("service_role", null, async () => {
        const token = await scalar(
          "select public_token from public.restaurants where id=$1",
          [A],
        );
        await db.query(
          "update public.restaurants set status='suspended' where id=$1",
          [A],
        );
        await db.query(
          "update public.restaurants set status='active' where id=$1",
          [A],
        );
        await db.exec("set local role authenticated");
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
          UA,
        ]);
        expect(await rows("select name from public.products")).toEqual([
          { name: "A dish" },
        ]);
        expect(await rows("select name from storage.objects")).toHaveLength(1);
        expect(
          await scalar(
            "select public_token from public.restaurants where id=$1",
            [A],
          ),
        ).toBe(token);
      }));

    it.each([1, 100, 999, 1000])(
      "imports %i products atomically within the supported batch size",
      async (size) => {
        await asRole("authenticated", UA, async () => {
          const batch = Array.from({ length: size }, (_, i) => ({
            name: "Load " + i,
            category: "Main",
            price: 1 + (i % 20),
            sku: "LOAD-" + i,
          }));
          const started = performance.now();
          expect(
            await scalar(
              "select public.import_products($1,$2::jsonb,'skip',false)",
              [A, JSON.stringify(batch)],
            ),
          ).toEqual({
            inserted: size,
            updated: 0,
            skipped: 0,
            categories_created: 0,
          });
          const milliseconds = Math.round(performance.now() - started);
          benchmarks.push({ rows: size, milliseconds });
          console.info(
            JSON.stringify({
              benchmark: "import_products",
              rows: size,
              milliseconds,
              engine: "PostgreSQL PGlite",
            }),
          );
          expect(
            Number(
              await scalar(
                "select count(*) from public.products where restaurant_id=$1",
                [A],
              ),
            ),
          ).toBe(size + 1);
        });
      },
    );
    it("rejects empty and 1001-row imports before creating any product", () =>
      asRole("authenticated", UA, async () => {
        await denied(
          "select public.import_products($1,'[]'::jsonb,'skip',false)",
          [A],
        );
        const batch = Array.from({ length: 1001 }, (_, i) => ({
          name: "Oversize " + i,
          category: "Main",
          price: 1,
        }));
        const started = performance.now();
        await denied(
          "select public.import_products($1,$2::jsonb,'skip',false)",
          [A, JSON.stringify(batch)],
        );
        benchmarks.push({
          rows: 1001,
          milliseconds: Math.round(performance.now() - started),
          rejected: true,
        });
        console.info(
          JSON.stringify({
            benchmark: "import_products_rejected",
            rows: 1001,
            milliseconds: Math.round(performance.now() - started),
            engine: "PostgreSQL PGlite",
          }),
        );
        expect(
          Number(
            await scalar(
              "select count(*) from public.products where restaurant_id=$1",
              [A],
            ),
          ),
        ).toBe(1);
      }));
    it("uses exact case-sensitive SKUs and preserves accents when identifying duplicates", () =>
      asRole("authenticated", UA, async () => {
        const batch = [
          { name: "Cafe", category: "Main", price: 2, sku: "CASE" },
          { name: "Caf\u00e9", category: "Main", price: 3, sku: "case" },
        ];
        expect(
          await scalar(
            "select public.import_products($1,$2::jsonb,'skip',false)",
            [A, JSON.stringify(batch)],
          ),
        ).toEqual({
          inserted: 2,
          updated: 0,
          skipped: 0,
          categories_created: 0,
        });
        expect(
          await scalar(
            "select public.import_products($1,$2::jsonb,'skip',false)",
            [
              A,
              JSON.stringify([
                { name: " cafe ", category: " MAIN ", price: 5 },
              ]),
            ],
          ),
        ).toEqual({
          inserted: 0,
          updated: 0,
          skipped: 1,
          categories_created: 0,
        });
      }));
    it("rejects cross-tenant appearance images, unsafe colors and unknown appearance fields at the database boundary", () =>
      asRole("authenticated", UA, async () => {
        await denied(
          "update public.restaurant_settings set appearance=$1::jsonb where restaurant_id=$2",
          [JSON.stringify({ logo_path: B + "/" + PROD_B + ".webp" }), A],
        );
        await denied(
          "update public.restaurant_settings set draft_appearance=$1::jsonb where restaurant_id=$2",
          [JSON.stringify({ cover_path: B + "/" + PROD_B + ".webp" }), A],
        );
        await denied(
          "update public.restaurant_settings set appearance=$1::jsonb where restaurant_id=$2",
          [JSON.stringify({ primary: "url(https://attacker.example)" }), A],
        );
        await denied(
          "update public.restaurant_settings set appearance=$1::jsonb where restaurant_id=$2",
          [JSON.stringify({ font: "unsafe", html: "<script>" }), A],
        );
        await db.query(
          "update public.restaurant_settings set appearance=$1::jsonb where restaurant_id=$2",
          [
            JSON.stringify({
              primary: "#123456",
              font: "sans",
              logo_path: A + "/" + PROD_A + ".webp",
            }),
            A,
          ],
        );
      }));
    it("aggregates all daily statistics beyond the REST row cap without exposing the other tenant", () =>
      asRole("service_role", null, async () => {
        await db.query(
          "insert into public.visit_events(restaurant_id,day,visits,qr_scans) select $1::uuid,current_date-i,2,1 from generate_series(0,1499) i",
          [A],
        );
        await db.query(
          "insert into public.visit_events(restaurant_id,day,visits,qr_scans) values($1,current_date,7,3)",
          [B],
        );
        const global = (await scalar("select public.admin_stats()")) as Record<
          string,
          unknown
        >;
        expect(global.total).toBe(2);
        expect(global.products).toBe(2);
        expect(global.visits).toBe(3007);
        expect(global.scans).toBe(1503);
        await db.exec("set local role authenticated");
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
          UA,
        ]);
        expect(await scalar("select public.restaurant_stats($1)", [A])).toEqual(
          {
            products: 1,
            published: 1,
            categories: 1,
            visits: 3000,
            scans: 1500,
          },
        );
        await denied("select public.restaurant_stats($1)", [B]);
        await denied("select public.admin_stats()");
      }));

    it("keeps different explicit SKUs independent even when product names match", () =>
      asRole("authenticated", UA, async () => {
        const sameNames = [
          { name: "Twin", category: "Main", price: 3, sku: "TWIN-A" },
          { name: "Twin", category: "Main", price: 4, sku: "TWIN-B" },
        ];
        expect(
          await scalar(
            "select public.import_products($1,$2::jsonb,'skip',false)",
            [A, JSON.stringify(sameNames)],
          ),
        ).toEqual({
          inserted: 2,
          updated: 0,
          skipped: 0,
          categories_created: 0,
        });
        expect(
          await scalar(
            "select public.import_products($1,$2::jsonb,'update',false)",
            [
              A,
              JSON.stringify([
                { name: "Twin", category: "Main", price: 8, sku: "TWIN-B" },
              ]),
            ],
          ),
        ).toEqual({
          inserted: 0,
          updated: 1,
          skipped: 0,
          categories_created: 0,
        });
        expect(
          await scalar(
            "select price::text from public.products where sku='TWIN-A'",
          ),
        ).toBe("3.00");
        expect(
          await scalar(
            "select price::text from public.products where sku='TWIN-B'",
          ),
        ).toBe("8.00");
        await denied(
          "select public.import_products($1,$2::jsonb,'update',false)",
          [A, JSON.stringify([{ name: "Twin", category: "Main", price: 9 }])],
        );
      }));
    it("supports idempotent hours and translation upserts under owner RLS", () =>
      asRole("authenticated", UA, async () => {
        const hourId = await scalar(
          "select id from public.restaurant_hours where restaurant_id=$1 and day_of_week=1",
          [A],
        );
        await db.query(
          "insert into public.restaurant_hours(restaurant_id,day_of_week,opens_at,closes_at,is_closed) values($1,1,'10:00','20:00',false) on conflict(restaurant_id,day_of_week) do update set opens_at=excluded.opens_at,closes_at=excluded.closes_at,is_closed=excluded.is_closed",
          [A],
        );
        expect(
          await scalar(
            "select id from public.restaurant_hours where restaurant_id=$1 and day_of_week=1",
            [A],
          ),
        ).toBe(hourId);
        expect(
          await scalar(
            "select opens_at::text from public.restaurant_hours where restaurant_id=$1 and day_of_week=1",
            [A],
          ),
        ).toBe("10:00:00");
        const upsert =
          "insert into public.translations(restaurant_id,entity_type,entity_id,language,fields) values($1,'product',$2,'en',$3::jsonb) on conflict(restaurant_id,entity_type,entity_id,language) do update set fields=excluded.fields returning id";
        const id = await scalar(upsert, [
          A,
          PROD_A,
          JSON.stringify({ name: "First" }),
        ]);
        expect(
          await scalar(upsert, [
            A,
            PROD_A,
            JSON.stringify({ name: "Revised" }),
          ]),
        ).toBe(id);
        expect(
          await scalar(
            "select fields->>'name' from public.translations where id=$1",
            [id],
          ),
        ).toBe("Revised");
      }));
    it("allows the platform to disable optional contact without publishing a sample address", () =>
      asRole("service_role", null, async () => {
        expect(
          await scalar(
            "select contact_url from public.platform_settings where id=true",
          ),
        ).toBeNull();
        await db.exec(
          "update public.platform_settings set contact_url='https://tolentino.example/contact' where id=true",
        );
        await db.exec(
          "update public.platform_settings set contact_url=null where id=true",
        );
        expect(
          await scalar(
            "select suspension_message from public.platform_settings where id=true",
          ),
        ).toBe("Este men\u00fa no est\u00e1 disponible temporalmente.");
        await denied(
          "update public.platform_settings set suspension_message='' where id=true",
        );
        expect(
          await scalar(
            "select contact_url from public.platform_settings where id=true",
          ),
        ).toBeNull();
      }));
  },
);


describe.sequential("Durable restaurant-creation transactions", () => {
  const requestId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const hash = "a".repeat(64);
  const data = { name: "Created DEMO", slug: "created-demo", owner_name: "Demo Owner",
    owner_email: "demo@tolentino.test", currency: "COP", sale_currency: "COP",
    default_language: "es", amount: 125000, demo: true };
  async function claim(value = hash) {
    return await scalar("select public.claim_restaurant_creation($1,$2,$3)", [ADMIN,requestId,value]) as {
      state: string; owner_id: string; restaurant_id: string; lease_token: string;
      response?: Record<string,unknown>; http_status?: number;
    };
  }
  async function authStub(id: string) {
    await db.exec("reset role");
    await db.query("insert into auth.users(id) values($1)",[id]);
    await db.exec("set local role service_role");
  }
  async function settle(token: string, outcome: string, response: unknown = null, status: number | null = null) {
    return await scalar("select public.settle_restaurant_creation($1,$2,$3,$4,$5,$6)",
      [ADMIN,requestId,token,outcome,response ? JSON.stringify(response) : null,status]) as Record<string,unknown>;
  }
  async function complete(token: string, input: unknown = data) {
    return await scalar("select public.complete_restaurant_creation($1,$2,$3,$4)",
      [ADMIN,requestId,token,JSON.stringify(input)]) as Record<string,unknown>;
  }
  it("denies owner/anonymous access to requests and every creation RPC", async () => {
    for (const role of ["anon","authenticated"] as const)
      await asRole(role,UA,async()=>{
        await denied("select * from private.restaurant_creation_requests");
        await denied("select public.claim_restaurant_creation($1,$2,$3)",[ADMIN,requestId,hash]);
        await denied("select public.complete_restaurant_creation($1,$2,$3,$4)",[ADMIN,requestId,A,"{}"]);
        await denied("select public.settle_restaurant_creation($1,$2,$3,'retry')",[ADMIN,requestId,A]);
      });
  });
  it("only reserves attempts for an active platform administrator",()=>asRole("service_role",null,async()=>{
    await denied("select public.claim_restaurant_creation($1,$2,$3)",[UA,requestId,hash]);
    await db.query("update public.platform_admins set is_active=false where user_id=$1",[ADMIN]);
    await denied("select public.claim_restaurant_creation($1,$2,$3)",[ADMIN,requestId,hash]);
  }));
  it("reserves once, rejects payload changes, and fences stale workers after retry",()=>asRole("service_role",null,async()=>{
    const first=await claim();
    expect(first.state).toBe("processing");
    expect((await claim()).state).toBe("pending");
    expect((await claim("b".repeat(64))).state).toBe("mismatch");
    expect(await scalar("select count(*)::int from private.restaurant_creation_requests")).toBe(1);
    await settle(first.lease_token,"retry");
    const resumed=await claim();
    expect(resumed.owner_id).toBe(first.owner_id);
    expect(resumed.restaurant_id).toBe(first.restaurant_id);
    expect(resumed.lease_token).not.toBe(first.lease_token);
    expect(await settle(first.lease_token,"cleanup",{error:"stale"},400)).toEqual({state:"pending"});
    await denied("select public.complete_restaurant_creation($1,$2,$3,$4)",[ADMIN,requestId,first.lease_token,JSON.stringify(data)]);
  }));
  it("atomically creates the tenant, membership, settings, QR, hours, sale, audit and replay result",()=>asRole("service_role",null,async()=>{
    const attempt=await claim();
    await authStub(attempt.owner_id);
    const result=await complete(attempt.lease_token);
    expect(result).toMatchObject({committed:true,response:{ok:true,restaurantId:attempt.restaurant_id,demo:true,invitationSent:false}});
    for (const table of ["restaurant_memberships","restaurant_settings","restaurant_qr_configs","commercial_sales"])
      expect(await scalar("select count(*)::int from public."+table+" where restaurant_id=$1",[attempt.restaurant_id])).toBe(1);
    expect(await scalar("select count(*)::int from public.restaurant_hours where restaurant_id=$1",[attempt.restaurant_id])).toBe(7);
    expect(await scalar("select count(*)::int from public.security_audit_events where restaurant_id=$1 and action='restaurant_created'",[attempt.restaurant_id])).toBe(1);
    expect(await scalar("select is_demo from public.restaurants where id=$1",[attempt.restaurant_id])).toBe(true);
    expect(await claim()).toMatchObject({state:"completed",http_status:201,response:{restaurantId:attempt.restaurant_id}});
    expect(await complete(attempt.lease_token)).toMatchObject({committed:false});
    await settle(attempt.lease_token,"invited");
    expect((await claim()).response?.invitationSent).toBe(false);
    expect(await scalar("select count(*)::int from public.security_audit_events where restaurant_id=$1",[attempt.restaurant_id])).toBe(1);
  }));
  it("rolls all business rows and audit back on a late sale constraint failure",()=>asRole("service_role",null,async()=>{
    const attempt=await claim();
    await authStub(attempt.owner_id);
    await denied("select public.complete_restaurant_creation($1,$2,$3,$4)",
      [ADMIN,requestId,attempt.lease_token,JSON.stringify({...data,amount:-1})]);
    expect(await scalar("select count(*)::int from public.restaurants where id=$1",[attempt.restaurant_id])).toBe(0);
    for (const table of ["restaurant_memberships","restaurant_settings","restaurant_qr_configs","restaurant_hours","commercial_sales","security_audit_events"])
      expect(await scalar("select count(*)::int from public."+table+" where restaurant_id=$1",[attempt.restaurant_id])).toBe(0);
    expect(await scalar("select state from private.restaurant_creation_requests")).toBe("processing");
  }));
  it("keeps cleanup durable after a slug conflict and never allows cleanup to re-enter provisioning",()=>asRole("service_role",null,async()=>{
    const attempt=await claim();
    await authStub(attempt.owner_id);
    await denied("select public.complete_restaurant_creation($1,$2,$3,$4)",
      [ADMIN,requestId,attempt.lease_token,JSON.stringify({...data,slug:"restaurant-a"})]);
    await settle(attempt.lease_token,"cleanup",{error:"Slug exists",code:"SLUG_TAKEN"},409);
    expect((await claim()).state).toBe("pending");
    await db.exec("update private.restaurant_creation_requests set lease_until=clock_timestamp()-interval '1 second'");
    const resumed=await claim();
    expect(resumed.state).toBe("cleanup");
    expect(resumed.owner_id).toBe(attempt.owner_id);
    await denied("select public.complete_restaurant_creation($1,$2,$3,$4)",
      [ADMIN,requestId,resumed.lease_token,JSON.stringify(data)]);
    expect(await settle(attempt.lease_token,"failed",{error:"stale"},409)).toEqual({state:"pending"});
    await settle(resumed.lease_token,"failed",resumed.response,409);
    expect(await claim()).toMatchObject({state:"failed",http_status:409,response:{code:"SLUG_TAKEN"}});
    expect(await scalar("select count(*)::int from public.restaurants where id=$1",[attempt.restaurant_id])).toBe(0);
  }));
  it("recovers the committed result instead of allowing a late cleanup decision",()=>asRole("service_role",null,async()=>{
    const attempt=await claim();
    await authStub(attempt.owner_id);
    await complete(attempt.lease_token);
    expect(await settle(attempt.lease_token,"cleanup",{error:"timeout"},503)).toMatchObject({
      state:"completed",response:{restaurantId:attempt.restaurant_id},
    });
    expect(await scalar("select count(*)::int from public.restaurant_memberships where user_id=$1",[attempt.owner_id])).toBe(1);
  }));
  it("enforces DEMO reserved addresses in SQL and keeps the flag unavailable to owner updates",async()=>{
    await asRole("service_role",null,async()=>{
      const attempt=await claim();
      await authStub(attempt.owner_id);
      await denied("select public.complete_restaurant_creation($1,$2,$3,$4)",
        [ADMIN,requestId,attempt.lease_token,JSON.stringify({...data,owner_email:"real@example.com"})]);
      expect(await scalar("select count(*)::int from public.restaurants where id=$1",[attempt.restaurant_id])).toBe(0);
    });
    await asRole("authenticated",UA,async()=>{await denied("update public.restaurants set is_demo=true where id=$1",[A]);});
  });
});
