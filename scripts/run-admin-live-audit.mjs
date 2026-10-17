import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Session, base } from "./live-client.mjs";
const manifest = JSON.parse(
  readFileSync("artifacts/demo/restaurants.json", "utf8"),
);
const [a, b] = manifest.restaurants;
const admin = new Session();
await admin.login(
  process.env.AUDIT_ADMIN_EMAIL,
  process.env.AUDIT_ADMIN_PASSWORD,
);
const results = process.env.AUDIT_ONLY
  ? JSON.parse(
      readFileSync("docs/evidence/live-admin-audit.json", "utf8"),
    ).results.filter((x) => x.name !== process.env.AUDIT_ONLY)
  : [];
async function check(name, run) {
  if (process.env.AUDIT_ONLY && name !== process.env.AUDIT_ONLY) return;
  try {
    await run();
    results.push({ name, pass: true });
    console.log("PASS " + name);
  } catch (e) {
    results.push({ name, pass: false, error: e.message });
    console.log("FAIL " + name + ": " + e.message);
  }
}
const change = (action, restaurantId, data, expected) =>
  admin.request("/api/admin/restaurants", {
    method: "POST",
    data: { action, restaurantId, data },
    expected,
  });
try {
  await check(
    "admin list, search, metrics and real support context",
    async () => {
      const list = (
        await admin.request("/api/admin/restaurants?q=Pizzer%C3%ADa")
      ).data;
      assert.equal(list.total, 1);
      assert.equal(list.restaurants[0].id, a.id);
      assert.equal(list.stats.total, 3);
      for (const r of manifest.restaurants) {
        const ws = (await admin.request("/api/workspace/" + r.id)).data;
        assert.equal(ws.role, "superadmin");
        assert.equal(ws.restaurant.id, r.id);
        assert.equal(ws.membership.is_active, true);
      }
    },
  );
  await check(
    "copy appearance excludes foreign images and preserves catalogue",
    async () => {
      const before = (await admin.request("/api/workspace/" + b.id)).data;
      try {
        await change("duplicate", a.id, { targetRestaurantId: b.id });
        const after = (await admin.request("/api/workspace/" + b.id)).data;
        assert.equal(after.settings.draft_appearance.logo_path, null);
        assert.equal(after.settings.draft_appearance.cover_path, null);
        assert.equal(after.total, before.total);
        assert.equal(
          after.restaurant.owner_email,
          before.restaurant.owner_email,
        );
      } finally {
        await admin.request("/api/workspace/" + b.id, {
          method: "POST",
          data: {
            action: "save_appearance",
            data: { appearance: before.settings.draft_appearance },
          },
        });
      }
    },
  );
  await check(
    "commercial note editing persists without changing owner",
    async () => {
      const before = (await admin.request("/api/workspace/" + a.id)).data;
      try {
        await change("update", a.id, {
          sale_notes: "Temporary DEMO audit note",
        });
        const after = (await admin.request("/api/workspace/" + a.id)).data;
        assert.equal(after.sale.notes, "Temporary DEMO audit note");
        assert.equal(
          after.restaurant.owner_email,
          before.restaurant.owner_email,
        );
      } finally {
        await change("update", a.id, { sale_notes: before.sale.notes });
      }
    },
  );
  await check(
    "superadmin can edit published image and restore it",
    async () => {
      const before = (
        await admin.request("/api/workspace/" + a.id + "?q=Margherita")
      ).data;
      const p = before.products.find(
          (x) => x.is_published && x.sku?.startsWith("DEMO-"),
        ),
        alternate = before.settings.appearance.cover_path;
      assert(p);
      try {
        await admin.request("/api/workspace/" + a.id, {
          method: "POST",
          data: {
            action: "save_product",
            data: { ...p, image_path: alternate },
          },
        });
        const menu = (
          await new Session().request(
            "/api/public/menu/" + before.restaurant.slug,
          )
        ).data;
        assert.equal(
          menu.products.find((x) => x.id === p.id).image_path,
          alternate,
        );
      } finally {
        await admin.request("/api/workspace/" + a.id, {
          method: "POST",
          data: { action: "save_product", data: p },
        });
      }
    },
  );
  await check("demo reset access blocks external email", async () => {
    const r = await change("reset_access", a.id, {}, [400]);
    assert.equal(r.data.code, "DEMO_EMAIL_DISABLED");
  });
  await check(
    "demo public recovery remains generic without email",
    async () => {
      const r = await new Session().request("/api/auth", {
        method: "POST",
        data: { action: "recover", email: a.owner },
      });
      assert.equal(r.data.ok, true);
    },
  );
  await check("nonexistent restaurant returns 404", async () => {
    await change(
      "update",
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
      { name: "Missing DEMO" },
      [404],
    );
  });
  await check("invalid media type rejected before upload", async () => {
    const form = new FormData();
    form.set(
      "file",
      new Blob(["not an image"], { type: "text/plain" }),
      "invalid.txt",
    );
    await admin.request("/api/workspace/" + a.id + "/media", {
      method: "POST",
      form,
      expected: [400],
    });
  });
  await check("forged raster file rejected before upload", async () => {
    const form = new FormData();
    form.set(
      "file",
      new Blob(["not a PNG"], { type: "image/png" }),
      "invalid.png",
    );
    await admin.request("/api/workspace/" + a.id + "/media", {
      method: "POST",
      form,
      expected: [400],
    });
  });
  await check("cross-origin mutation rejected", async () => {
    const cookie = [...admin.jar].map(([k, v]) => k + "=" + v).join("; ");
    const r = await fetch(base + "/api/admin/restaurants", {
      method: "POST",
      headers: {
        cookie,
        origin: "https://untrusted.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "status",
        restaurantId: a.id,
        data: { status: "suspended" },
      }),
    });
    assert.equal(r.status, 403);
  });
} finally {
  await admin.logout();
  writeFileSync(
    "docs/evidence/live-admin-audit.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        results,
        passed: results.filter((x) => x.pass).length,
        failed: results.filter((x) => !x.pass).length,
      },
      null,
      2,
    ),
  );
}
if (results.some((x) => !x.pass)) process.exitCode = 1;
