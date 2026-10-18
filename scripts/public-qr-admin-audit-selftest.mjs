import assert from "node:assert/strict";
import { test } from "node:test";
import QRCode from "qrcode";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import {
  PUBLIC_ORIGIN,
  confirmedPublicOrigin,
  decodeQrArtifact,
} from "./public-qr-admin-audit.mjs";
globalThis.fetch = async () => {
  throw Error("NETWORK_FORBIDDEN_IN_LOCAL_SELFTEST");
};
const base = PUBLIC_ORIGIN;
const qrUrl = base + "/q/11111111-1111-4111-8111-111111111111";
test("requires exactly confirmed HTTPS public origin and an explicit public run ID", () => {
  assert.equal(confirmedPublicOrigin(base, base, "public-fixture"), base);
});
for (const [name, actual, confirmed, run] of [
  [
    "HTTP",
    "http://audit.example.com",
    "http://audit.example.com",
    "public-fixture",
  ],
  ["origin mismatch", base, "https://other.example.com", "public-fixture"],
  ["localhost", "https://localhost", "https://localhost", "public-fixture"],
  [
    "reserved test domain",
    "https://audit.test",
    "https://audit.test",
    "public-fixture",
  ],
  ["URL userinfo", "https://user@audit.example.com", base, "public-fixture"],
  ["URL path", base + "/other", base + "/other", "public-fixture"],
  ["missing public run ID", base, base, undefined],
  ["local run ID", base, base, "local-acceptance-fixture"],
])
  test("rejects " + name + " before public authentication", () => {
    assert.throws(() => confirmedPublicOrigin(actual, confirmed, run));
  });
test("independently decodes a generated PNG artifact without network", async () => {
  const png = await QRCode.toBuffer(qrUrl, {
    width: 512,
    errorCorrectionLevel: "H",
    margin: 4,
  });
  assert.equal((await decodeQrArtifact(png, "png")).decoded, qrUrl);
});
test("independently rasterizes and decodes SVG without network", async () => {
  const svg = await QRCode.toString(qrUrl, {
    type: "svg",
    width: 512,
    errorCorrectionLevel: "H",
    margin: 4,
  });
  assert.equal(
    (await decodeQrArtifact(Buffer.from(svg), "svg")).decoded,
    qrUrl,
  );
});
test("independently extracts and decodes the PDF image without network", async () => {
  const png = await sharp(
    await QRCode.toBuffer(qrUrl, {
      width: 512,
      errorCorrectionLevel: "H",
      margin: 4,
    }),
  )
    .removeAlpha()
    .toColourspace("srgb")
    .png()
    .toBuffer();
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(png);
  pdf
    .addPage([288, 288])
    .drawImage(image, { x: 0, y: 0, width: 288, height: 288 });
  assert.equal(
    (await decodeQrArtifact(Buffer.from(await pdf.save()), "pdf")).decoded,
    qrUrl,
  );
});
test("rejects empty, unsupported and non-QR artifacts", async () => {
  await assert.rejects(
    decodeQrArtifact(Buffer.alloc(0), "png"),
    /QR_BYTES_INVALID/,
  );
  await assert.rejects(
    decodeQrArtifact(Buffer.from("x"), "zip"),
    /QR_FORMAT_INVALID/,
  );
  const blank = await sharp({
    create: { width: 128, height: 128, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  await assert.rejects(decodeQrArtifact(blank, "png"), /QR_NOT_DECODABLE/);
});
