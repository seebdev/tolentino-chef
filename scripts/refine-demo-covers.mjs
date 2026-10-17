import assert from "node:assert/strict";
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { coverArtwork, demos } from "./demo-catalog.mjs";
import { Session } from "./live-client.mjs";
const accounts = JSON.parse(
  readFileSync(".runtime/demo-accounts.json", "utf8"),
);
const result = [];
for (const demo of demos) {
  const account = accounts[demo.key];
  const owner = new Session();
  await owner.login(account.email, account.password);
  try {
    const workspace = (
      await owner.request("/api/workspace/" + account.restaurantId)
    ).data;
    assert.equal(workspace.restaurant.is_demo, true);
    assert.equal(workspace.restaurant.slug, demo.slug);
    const svg = coverArtwork(demo);
    assert(!svg.includes("<text"));
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const form = new FormData();
    form.set("file", new Blob([png], { type: "image/png" }), "cover.png");
    const uploaded = await owner.request(
      "/api/workspace/" + account.restaurantId + "/media",
      { method: "POST", form },
    );
    const appearance = {
      ...workspace.settings.draft_appearance,
      cover_path: uploaded.data.path,
    };
    for (const [action, data] of [
      ["save_appearance", { appearance }],
      ["publish_appearance", {}],
    ]) {
      await owner.request("/api/workspace/" + account.restaurantId, {
        method: "POST",
        data: { action, data },
      });
    }
    const menu = (await new Session().request("/api/public/menu/" + demo.slug))
      .data;
    assert.equal(menu.settings.appearance.cover_path, uploaded.data.path);
    writeFileSync("artifacts/demo/" + demo.key + "-cover.png", png);
    account.media.cover = uploaded.data.path;
    writeFileSync(
      ".runtime/demo-accounts.json",
      JSON.stringify(accounts, null, 2),
    );
    result.push({
      restaurant: demo.key,
      result: "PASS",
      change:
        "Cover uses original vector illustration without embedded text; identity remains accessible DOM text",
      path: uploaded.data.path,
    });
  } finally {
    await owner.logout();
  }
}
writeFileSync(
  "docs/evidence/demo-cover-refinement.json",
  JSON.stringify({ at: new Date().toISOString(), result }, null, 2),
);
console.log("PASS 3 original DEMO covers without duplicated embedded labels");
