import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import jsQR from "jsqr";
import { Session, base } from "./live-client.mjs";
import { demos } from "./demo-catalog.mjs";
const manifest = JSON.parse(
  readFileSync("artifacts/demo/restaurants.json", "utf8"),
);
const accounts = JSON.parse(
  readFileSync(".runtime/demo-accounts.json", "utf8"),
);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(new URL(url).hostname, "ylcnrfzosjzuljufwups.supabase.co");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, opts);
const admin = new Session();
await admin.login(
  process.env.AUDIT_ADMIN_EMAIL,
  process.env.AUDIT_ADMIN_PASSWORD,
);
const checks = [];
const owners = [];
const qrResults = [];
mkdirSync("artifacts/qr/local-validation", { recursive: true });
function persist() {
  writeFileSync(
    "docs/evidence/live-audit.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        environment: base,
        database: "Supabase real",
        checks,
        passed: checks.filter((x) => x.pass).length,
        failed: checks.filter((x) => !x.pass).length,
        qr: qrResults,
        limitations: [
          "No public deployment",
          "No physical QR scan",
          "No SMTP email delivery test; demo recipients are reserved .test addresses",
        ],
      },
      null,
      2,
    ),
  );
}
async function check(name, run) {
  try {
    const detail = await run();
    checks.push({ name, pass: true, detail: detail ?? null });
    console.log("PASS " + name);
  } catch (e) {
    checks.push({ name, pass: false, error: String(e.message).slice(0, 450) });
    console.log("FAIL " + name + ": " + String(e.message).slice(0, 160));
  }
  persist();
}
const post = (s, id, action, data, expected) =>
  s.request("/api/workspace/" + id, {
    method: "POST",
    data: { action, data },
    expected,
  });
try {
  for (const item of manifest.restaurants) {
    const s = new Session();
    const a = accounts[item.key];
    const login = await s.login(a.email, a.password);
    const client = createClient(
      url,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      opts,
    );
    const auth = await client.auth.signInWithPassword({
      email: a.email,
      password: a.password,
    });
    assert.equal(auth.error, null);
    owners.push({ item, s, client, user: auth.data.user });
    await check(item.key + " owner login and assignment", async () => {
      assert.equal(login.role, "owner");
      const session = (await s.request("/api/session")).data;
      assert.equal(session.restaurantId, item.id);
    });
  }
  await check("anonymous administrative API is protected", async () => {
    const r = await new Session().request("/api/admin/restaurants", {
      expected: [401],
    });
    assert.equal(r.status, 401);
  });
  for (const a of owners) {
    const { item, s, client } = a;
    const ws = (await s.request("/api/workspace/" + item.id)).data;
    a.workspace = ws;
    await check(
      item.key + " real public menu, images and tenant identity",
      async () => {
        const menu = (
          await new Session().request(
            "/api/public/menu/" + item.localMenu.split("/").at(-1),
          )
        ).data;
        assert.equal(menu.restaurant.id, item.id);
        assert.equal(menu.products.length, 24);
        assert(menu.products.some((x) => x.variants.length));
        assert(menu.products.some((x) => x.extras.length));
        assert(menu.products.some((x) => !x.is_available));
        assert(menu.categories.some((x) => x.parent_id));
        assert.equal(menu.hours.length, 7);
        assert(menu.promotions.length);
        assert(menu.settings.enabled_languages.includes("en"));
        assert(!JSON.stringify(menu).includes(item.owner));
        for (const p of [...new Set(menu.products.map((x) => x.image_path))]) {
          const image = await new Session().request(
            "/api/media/" + item.id + "/" + p,
          );
          assert(image.headers.get("content-type").startsWith("image/"));
        }
        return {
          products: menu.products.length,
          categories: menu.categories.length,
          images: 6,
        };
      },
    );
    await check(
      item.key + " owner cannot use superadmin endpoint",
      async () => {
        assert.equal(
          (await s.request("/api/admin/restaurants", { expected: [403] }))
            .status,
          403,
        );
      },
    );
    await check(
      item.key + " owner cannot change QR administration",
      async () => {
        assert.equal(
          (
            await post(
              s,
              item.id,
              "save_qr",
              {
                foreground: "#000000",
                background: "#FFFFFF",
                frame: "none",
                label: "QA",
                include_logo: false,
              },
              [403],
            )
          ).status,
          403,
        );
      },
    );
    await check(item.key + " nonexistent product returns 404", async () => {
      assert.equal(
        (await post(s, item.id, "delete_product", { id: randomUUID() }, [404]))
          .status,
        404,
      );
    });
    await check(item.key + " invalid price is rejected", async () => {
      assert.equal(
        (
          await post(
            s,
            item.id,
            "save_product",
            { category_id: ws.categories[0].id, name: "QA invalid", price: -1 },
            [400],
          )
        ).status,
        400,
      );
    });
    await check(
      item.key + " invalid appearance has no partial write",
      async () => {
        const before = ws.settings.draft_appearance;
        assert.equal(
          (
            await post(
              s,
              item.id,
              "save_appearance",
              {
                name: "x",
                appearance: {
                  primary: "#123456",
                  secondary: "#FFFFFF",
                  font: "sans",
                },
              },
              [400],
            )
          ).status,
          400,
        );
        const after = (await s.request("/api/workspace/" + item.id)).data
          .settings.draft_appearance;
        assert.deepEqual(after, before);
      },
    );
    await check(
      item.key + " CRUD product, public price, availability, delete",
      async () => {
        const value = {
          category_id: ws.categories[0].id,
          name: "QA TEMP DEMO " + item.key,
          description: "Temporary audit record",
          price: 12345,
          sku: "QA-TEMP-" + randomUUID(),
          is_published: true,
          is_available: true,
          variants: [{ name: "Grande", price: 2000 }],
          extras: [{ name: "Extra", price: 500 }],
        };
        let product;
        try {
          product = (await post(s, item.id, "save_product", value)).data.data;
          assert(product.id);
          const changed = {
            ...value,
            id: product.id,
            price: 13500,
            is_available: false,
          };
          await post(s, item.id, "save_product", changed);
          const menu = (
            await new Session().request(
              "/api/public/menu/" + ws.restaurant.slug,
            )
          ).data;
          const visible = menu.products.find((x) => x.id === product.id);
          assert.equal(Number(visible.price), 13500);
          assert.equal(visible.is_available, false);
          assert.equal(visible.variants[0].name, "Grande");
        } finally {
          if (product)
            await post(s, item.id, "delete_product", { id: product.id });
        }
        const after = (
          await new Session().request("/api/public/menu/" + ws.restaurant.slug)
        ).data;
        assert(!after.products.some((x) => x.id === product.id));
      },
    );
    await check(
      item.key + " category/subcategory and promotion CRUD",
      async () => {
        let parent, child, promo;
        try {
          parent = (
            await post(s, item.id, "save_category", {
              name: "QA TEMP parent",
              sort_order: 999,
              is_visible: false,
            })
          ).data.data;
          child = (
            await post(s, item.id, "save_category", {
              name: "QA TEMP child",
              parent_id: parent.id,
              sort_order: 1000,
            })
          ).data.data;
          await post(s, item.id, "save_category", {
            ...child,
            name: "QA TEMP updated",
            sort_order: 998,
          });
          promo = (
            await post(s, item.id, "save_promotion", {
              title: "QA TEMP offer",
              description: "DEMO",
              is_active: false,
            })
          ).data.data;
          await post(s, item.id, "save_promotion", {
            ...promo,
            title: "QA TEMP offer updated",
          });
        } finally {
          if (promo)
            await post(s, item.id, "delete_promotion", { id: promo.id });
          if (child)
            await post(s, item.id, "delete_category", { id: child.id });
          if (parent)
            await post(s, item.id, "delete_category", { id: parent.id });
        }
      },
    );
    for (const b of owners.filter((b) => b.item.id !== item.id)) {
      await check(
        item.key + " -> " + b.item.key + " cross-tenant API read/write blocked",
        async () => {
          assert.equal(
            (
              await s.request("/api/workspace/" + b.item.id, {
                expected: [403],
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await post(
                s,
                b.item.id,
                "save_category",
                { name: "ATTEMPT" },
                [403],
              )
            ).status,
            403,
          );
        },
      );
      await check(
        item.key +
          " -> " +
          b.item.key +
          " direct PostgREST RLS read/write blocked",
        async () => {
          const read = await client
            .from("products")
            .select("id")
            .eq("restaurant_id", b.item.id);
          assert.equal(read.error, null);
          assert.equal(read.data.length, 0);
          const write = await client
            .from("products")
            .update({ price: 1 })
            .eq("restaurant_id", b.item.id)
            .select("id");
          assert.equal(write.error, null);
          assert.equal(write.data.length, 0);
        },
      );
      await check(
        item.key + " -> " + b.item.key + " private Storage cannot download",
        async () => {
          const result = await client.storage
            .from("restaurant-media")
            .download(b.item.logoPath);
          assert(result.error);
        },
      );
      await check(
        item.key + " -> " + b.item.key + " foreign media reference rejected",
        async () => {
          assert.equal(
            (
              await post(
                s,
                item.id,
                "save_product",
                {
                  category_id: ws.categories[0].id,
                  name: "QA invalid foreign image",
                  price: 10,
                  image_path: b.item.logoPath,
                },
                [400],
              )
            ).status,
            400,
          );
        },
      );
    }
    await check(
      item.key + " cannot escalate role through database",
      async () => {
        const r = await client
          .from("platform_admins")
          .insert({ user_id: a.user.id, is_active: true });
        assert(r.error);
      },
    );
    await check(item.key + " logout/relogin persistence", async () => {
      await s.logout();
      assert.equal(
        (await s.request("/api/session", { expected: [401] })).status,
        401,
      );
      await s.login(accounts[item.key].email, accounts[item.key].password);
      const again = (await s.request("/api/workspace/" + item.id)).data;
      assert.equal(again.total, 24);
      assert.equal(again.restaurant.id, item.id);
    });
    await check(
      item.key + " superadmin suspension/reactivation with same QR",
      async () => {
        try {
          await admin.request("/api/admin/restaurants", {
            method: "POST",
            data: {
              action: "status",
              restaurantId: item.id,
              data: { status: "suspended" },
            },
          });
          assert.equal(
            (await s.request("/api/workspace/" + item.id, { expected: [403] }))
              .status,
            403,
          );
          assert.equal(
            (
              await new Session().request(
                "/api/public/menu/" + ws.restaurant.slug,
                { expected: [410] },
              )
            ).status,
            410,
          );
        } finally {
          await admin.request("/api/admin/restaurants", {
            method: "POST",
            data: {
              action: "status",
              restaurantId: item.id,
              data: { status: "active" },
            },
          });
        }
        assert.equal(
          (await s.request("/api/workspace/" + item.id)).status,
          200,
        );
      },
    );
    await check(
      item.key + " owner access suspension/reactivation",
      async () => {
        try {
          await admin.request("/api/admin/restaurants", {
            method: "POST",
            data: {
              action: "owner_status",
              restaurantId: item.id,
              data: { is_active: false },
            },
          });
          assert.equal(
            (await s.request("/api/workspace/" + item.id, { expected: [403] }))
              .status,
            403,
          );
        } finally {
          await admin.request("/api/admin/restaurants", {
            method: "POST",
            data: {
              action: "owner_status",
              restaurantId: item.id,
              data: { is_active: true },
            },
          });
        }
      },
    );
    await check(
      item.key + " real QR PNG SVG PDF decoding and stable slug resolution",
      async () => {
        const expected = base + item.stableRoute;
        for (const format of ["png", "svg", "pdf"]) {
          const r = await s.request(
            "/api/workspace/" + item.id + "/qr?format=" + format,
          );
          const path =
            "artifacts/qr/local-validation/" + item.key + "." + format;
          writeFileSync(path, r.data);
          let decoded = null;
          if (format !== "pdf") {
            const pixels = await sharp(r.data)
              .ensureAlpha()
              .raw()
              .toBuffer({ resolveWithObject: true });
            decoded = jsQR(
              new Uint8ClampedArray(pixels.data),
              pixels.info.width,
              pixels.info.height,
            )?.data;
            assert.equal(decoded, expected);
          }
          qrResults.push({
            restaurant: item.key,
            format,
            path,
            decodedUrl: decoded,
            status:
              format === "pdf"
                ? "exported; PNG raster source independently decoded"
                : "decoded locally",
            publicReady: false,
          });
        }
        const resolve = () =>
          new Session().request(item.stableRoute, { expected: [302] });
        assert.equal(
          (await resolve()).headers.get("location"),
          base + "/menu/" + ws.restaurant.slug,
        );
        const nextSlug = ws.restaurant.slug + "-qa";
        try {
          await admin.request("/api/admin/restaurants", {
            method: "POST",
            data: {
              action: "update",
              restaurantId: item.id,
              data: { slug: nextSlug },
            },
          });
          assert.equal(
            (await resolve()).headers.get("location"),
            base + "/menu/" + nextSlug,
          );
          const menu = (
            await new Session().request("/api/public/menu/" + nextSlug)
          ).data;
          assert.equal(menu.restaurant.id, item.id);
        } finally {
          await admin.request("/api/admin/restaurants", {
            method: "POST",
            data: {
              action: "update",
              restaurantId: item.id,
              data: { slug: ws.restaurant.slug },
            },
          });
        }
        assert.equal(
          (await resolve()).headers.get("location"),
          base + "/menu/" + ws.restaurant.slug,
        );
        return { expected, publicReady: false, physicalScan: false };
      },
    );
  }
  await check(
    "real creation replay, concurrent replay and genuine email/slug conflicts",
    async () => {
      const item = manifest.restaurants.find((x) => x.key === "bruma");
      const demo = demos.find((x) => x.key === "bruma");
      const auth = await service.auth.admin.getUserById(accounts.bruma.userId);
      assert.equal(auth.error, null);
      const requestId = auth.data.user.app_metadata.creation_request_id;
      const data = {
        name: demo.name,
        slug: demo.slug,
        owner_name: demo.owner,
        owner_email: demo.email,
        description: demo.description,
        demo: true,
      };
      const replay = () =>
        admin.request("/api/admin/restaurants", {
          method: "POST",
          data: { action: "create", requestId, data },
          expected: [201],
        });
      const both = await Promise.all([replay(), replay()]);
      for (const r of both) {
        assert.equal(r.data.restaurantId, item.id);
        assert.equal(r.data.replayed, true);
      }
      const mismatch = await admin.request("/api/admin/restaurants", {
        method: "POST",
        data: {
          action: "create",
          requestId,
          data: { ...data, name: "Different request DEMO" },
        },
        expected: [409],
      });
      assert.equal(mismatch.data.code, "IDEMPOTENCY_KEY_REUSED");
      const before = (
        await service.auth.admin.listUsers({ page: 1, perPage: 1000 })
      ).data.users.length;
      const emailConflict = await admin.request("/api/admin/restaurants", {
        method: "POST",
        data: {
          action: "create",
          requestId: randomUUID(),
          data: { ...data, slug: "qa-conflict-" + randomUUID() },
        },
        expected: [409],
      });
      assert.equal(emailConflict.data.code, "OWNER_EMAIL_EXISTS");
      const slugConflict = await admin.request("/api/admin/restaurants", {
        method: "POST",
        data: {
          action: "create",
          requestId: randomUUID(),
          data: {
            ...data,
            owner_email: "qa-" + randomUUID() + "@tolentino-demo.test",
          },
        },
        expected: [409],
      });
      assert.equal(slugConflict.data.code, "SLUG_TAKEN");
      const after = (
        await service.auth.admin.listUsers({ page: 1, perPage: 1000 })
      ).data.users.length;
      assert.equal(after, before);
      const count = (
        await service
          .from("restaurants")
          .select("id", { count: "exact", head: true })
      ).count;
      assert.equal(count, 3);
      return {
        replayedRequests: 2,
        restaurantCount: count,
        orphanAccounts: after - before,
        emailConflict: 409,
        slugConflict: 409,
      };
    },
  );
  // Real CSV writes are confined to a hidden, task-owned category and removed afterwards.
  const a = owners[0],
    id = a.item.id,
    s = a.s,
    prefix = "QA-CSV-" + randomUUID();
  let category;
  try {
    category = (
      await post(s, id, "save_category", {
        name: prefix,
        sort_order: 9999,
        is_visible: false,
      })
    ).data.data;
    const csv = (n) =>
      "nombre,precio,categoria,descripcion,sku\n" +
      Array.from({ length: n }, (_, i) =>
        [
          "Prueba café ñ " + n + "-" + i,
          100 + i,
          prefix,
          "Importación UTF-8 DEMO",
          prefix + "-" + n + "-" + i,
        ].join(","),
      ).join("\n");
    for (const n of [1, 10, 100, 500, 1000])
      await check(
        "real CSV " + n + " rows transactional import and duplicate skip",
        async () => {
          const start = Date.now();
          const input = {
            action: "commit",
            csv: csv(n),
            mode: "skip",
            createCategories: false,
          };
          const result = (
            await s.request("/api/workspace/" + id + "/import", {
              method: "POST",
              data: input,
            })
          ).data;
          assert.equal(result.summary.created, n);
          const again = (
            await s.request("/api/workspace/" + id + "/import", {
              method: "POST",
              data: input,
            })
          ).data;
          assert.equal(again.summary.created, 0);
          assert.equal(again.summary.skipped, n);
          return {
            rows: n,
            milliseconds: Date.now() - start,
            duplicatesCreated: 0,
          };
        },
      );
    const negatives = [
      ["empty", ""],
      ["wrong headers", "x,y,z\na,b,c"],
      ["missing price", "nombre,categoria\nProducto," + prefix],
      ["invalid price", "nombre,precio,categoria\nProducto,-1," + prefix],
      [
        "unknown category",
        "nombre,precio,categoria\nProducto,10,Missing category",
      ],
      [
        "duplicate rows",
        "nombre,precio,categoria\nSame,10," + prefix + "\nSame,10," + prefix,
      ],
      ["corrupt quotes", 'nombre,precio,categoria\n"broken,10,' + prefix],
      ["bad UTF8", "nombre,precio,categoria\nBad\uFFFD,10," + prefix],
      ["1001 rows", csv(1001)],
    ];
    for (const [name, text] of negatives)
      await check("real CSV rejects " + name, async () => {
        assert.equal(
          (
            await s.request("/api/workspace/" + id + "/import", {
              method: "POST",
              data: {
                action: "commit",
                csv: text,
                mode: "skip",
                createCategories: false,
              },
              expected: [400],
            })
          ).status,
          400,
        );
      });
    await check(
      "catalog CSV exports beyond 1000 records without private fields",
      async () => {
        const exportFile = await s.request(
          "/api/workspace/" + id + "/import?download=catalog",
        );
        const text = exportFile.data.toString("utf8");
        assert(text.includes(prefix + "-1000-999"));
        assert(!text.includes("owner_email"));
        return { bytes: exportFile.data.length };
      },
    );
  } finally {
    if (category) {
      const removed = await service
        .from("products")
        .delete()
        .eq("restaurant_id", id)
        .eq("category_id", category.id)
        .like("sku", prefix + "-%");
      assert.equal(removed.error, null);
      await post(s, id, "delete_category", { id: category.id });
    }
  }
  await check(
    "no QA records remain and all demos retain 24 products",
    async () => {
      for (const a of owners) {
        const ws = (await a.s.request("/api/workspace/" + a.item.id)).data;
        assert.equal(ws.total, 24);
        assert(!ws.categories.some((x) => x.name.startsWith("QA-")));
      }
    },
  );
} finally {
  for (const a of owners) {
    await a.s.logout().catch(() => {});
    await a.client.auth.signOut({ scope: "local" });
  }
  await admin.logout().catch(() => {});
  persist();
}
console.log(
  JSON.stringify({
    passed: checks.filter((x) => x.pass).length,
    failed: checks.filter((x) => !x.pass).length,
    qrFiles: qrResults.length,
    publicDeployment: false,
  }),
);
if (checks.some((x) => !x.pass)) process.exitCode = 1;
