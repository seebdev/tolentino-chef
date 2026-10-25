import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
let db: PGlite;
const tenant = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  admin = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const rows = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({
    name: `Producto ${prefix} ${i}`,
    price: i + 1,
    category: "Importados",
    sku: `${prefix}-${i}`,
    description: "Prueba local",
  }));
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;create schema auth;create schema storage;grant usage on schema public,auth,storage to anon,authenticated,service_role;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,unique(bucket_id,name));alter table storage.objects enable row level security;grant all on storage.objects to authenticated,service_role;",
  );
  await db.exec(
    "alter table auth.users add column raw_app_meta_data jsonb default '{}';create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz default now());",
  );
  for (const file of readdirSync("supabase/migrations")
    .filter((x) => x.endsWith(".sql"))
    .sort())
    await db.exec(
      readFileSync(join("supabase/migrations", file), "utf8").replace(
        /^\uFEFF/,
        "",
      ),
    );
  await db.query("insert into auth.users(id) values($1),($2),($3)", [
    owner,
    ownerB,
    admin,
  ]);
  await db.exec("set role service_role");
  await db.query(
    "select public.provision_restaurant($1,$2,'Local A','local-a','A','a@test.invalid')",
    [tenant, owner],
  );
  await db.query(
    "select public.provision_restaurant($1,$2,'Local B','local-b','B','b@test.invalid')",
    [other, ownerB],
  );
  await db.query("insert into public.platform_admins(user_id) values($1)", [
    admin,
  ]);
  await db.exec("reset role");
}, 60000);
afterAll(async () => db?.close());
async function invoke(
  id: string,
  data: unknown[],
  mode = "skip",
  actor = owner,
  restaurant = tenant,
  hash = "a".repeat(64),
) {
  const result = await db.query<{
    result: {
      status: string;
      replayed: boolean;
      result: {
        inserted: number;
        updated: number;
        skipped: number;
        rejected: number;
      };
    };
  }>(
    "select public.import_products_attempt($1,$2,$3,$4::jsonb,$5,true,$6) result",
    [restaurant, id, hash, JSON.stringify(data), mode, actor],
  );
  return result.rows[0].result;
}
async function asOwner(work: () => Promise<void>, user = owner) {
  await db.exec("begin;set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
  try {
    await work();
  } finally {
    await db.exec("rollback");
  }
}
describe("private CSV attempt journal in actual local PostgreSQL", () => {
  for (const count of [1, 123, 1000])
    it(`${count} rows commit once; replay and a later skip do not duplicate`, async () => {
      await asOwner(async () => {
        const id = randomUUID(),
          data = rows(count, String(count));
        const first = await invoke(id, data);
        expect(first.status).toBe("completed");
        expect(first.result.inserted).toBe(count);
        const again = await invoke(id, data);
        expect(again.replayed).toBe(true);
        expect(again.result).toEqual(first.result);
        expect((await invoke(randomUUID(), data)).result.skipped).toBe(count);
        const got = await db.query<{
          value: { found: boolean; status: string };
        }>("select public.get_import_attempt($1,$2,$3) value", [
          tenant,
          id,
          owner,
        ]);
        expect(got.rows[0].value).toMatchObject({
          found: true,
          status: "completed",
        });
      });
    }, 30000);
  it("late invalid row rolls back earlier products and category, then records a failed result", async () => {
    await asOwner(async () => {
      const data = rows(3, "rollback");
      data[2].price = -1;
      const attempt = await invoke(randomUUID(), data);
      expect(attempt.status).toBe("failed");
      expect(attempt.result.rejected).toBe(3);
      expect(
        (
          await db.query(
            "select id from public.products where restaurant_id=$1",
            [tenant],
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await db.query(
            "select id from public.categories where restaurant_id=$1",
            [tenant],
          )
        ).rows,
      ).toHaveLength(0);
    });
  });
  it("rejects altered rows even when a caller reuses a supplied hash", async () => {
    await asOwner(async () => {
      const id = randomUUID();
      await invoke(id, rows(1, "first"));
      await expect(invoke(id, rows(1, "altered"))).rejects.toThrow(/conflict/);
    });
  });
  for (const count of [0, 1001])
    it(`rejects ${count} without an attempt or products`, async () => {
      await asOwner(async () => {
        await expect(invoke(randomUUID(), rows(count, "size"))).rejects.toThrow(
          /invalid_import_request/,
        );
      });
    });
  it("denies actor impersonation, another tenant and direct private journal reads", async () => {
    await asOwner(async () => {
      await expect(
        invoke(randomUUID(), rows(1, "actor"), "skip", admin),
      ).rejects.toThrow(/denied/);
    });
    await asOwner(async () => {
      await expect(
        invoke(randomUUID(), rows(1, "other"), "skip", owner, other),
      ).rejects.toThrow(/denied/);
    });
    await asOwner(async () => {
      await expect(
        db.query("select * from private.import_attempts"),
      ).rejects.toThrow(/permission/);
    });
  });
  it("allows service support with a real active admin but rejects an owner as a forged admin", async () => {
    await db.exec("begin;set local role service_role");
    try {
      expect(
        (await invoke(randomUUID(), rows(1, "support"), "skip", admin)).status,
      ).toBe("completed");
      await expect(
        invoke(randomUUID(), rows(1, "forged"), "skip", owner),
      ).rejects.toThrow(/admin_required/);
    } finally {
      await db.exec("rollback");
    }
  });
  for (const flag of ["reset_pending", "requires_password_change"])
    it(`denies imports and recovery while owner ${flag}`, async () => {
      await db.exec("begin");
      try {
        await db.query(
          `insert into private.owner_access(restaurant_id,user_id,${flag}) values($1,$2,true) on conflict(restaurant_id) do update set ${flag}=true`,
          [tenant, owner],
        );
        await db.exec("set local role authenticated");
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
          owner,
        ]);
        await db.exec("savepoint request");
        await expect(invoke(randomUUID(), rows(1, flag))).rejects.toThrow(
          /denied/,
        );
        await db.exec("rollback to savepoint request");
        await expect(
          db.query("select public.get_import_attempt($1,$2,$3)", [
            tenant,
            randomUUID(),
            owner,
          ]),
        ).rejects.toThrow(/denied/);
      } finally {
        await db.exec("rollback");
      }
    });
  it("increments QR configuration atomically, preserves the token and rejects stale versions", async () => {
    await db.exec("begin;set local role service_role");
    try {
      const token = (
        await db.query<{ public_token: string }>(
          "select public_token from public.restaurants where id=$1",
          [tenant],
        )
      ).rows[0].public_token;
      const config = {
        foreground: "#163c2c",
        background: "#ffffff",
        frame: "rounded",
        label: "Menú",
        include_logo: false,
        logo_size: 12,
        font_family: "serif",
        export_size: 512,
        module_style: "rounded",
      };
      const changed = await db.query<{ data: { config_version: number } }>(
        "select public.save_qr_configuration($1,$2,1) data",
        [tenant, JSON.stringify(config)],
      );
      expect(changed.rows[0].data.config_version).toBe(2);
      expect(
        (
          await db.query<{ public_token: string }>(
            "select public_token from public.restaurants where id=$1",
            [tenant],
          )
        ).rows[0].public_token,
      ).toBe(token);
      await expect(
        db.query("select public.save_qr_configuration($1,$2,1)", [
          tenant,
          JSON.stringify(config),
        ]),
      ).rejects.toThrow(/qr_version_conflict/);
    } finally {
      await db.exec("rollback");
    }
  });
});
