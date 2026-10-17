import {
  loadTargetDemos,
  auditBase,
  artifactPath,
  evidencePath,
  projectRef,
  runId,
} from "./audit-target.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import sharp from "sharp";
import jsQR from "jsqr";
import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
} from "pdf-lib";
import { inflateSync } from "node:zlib";
const { manifest } = loadTargetDemos({ accounts: false });
const base = auditBase();
if (!process.env.AUDIT_RUN_ID) throw Error("QR_REQUIRES_EXPLICIT_AUDIT_RUN_ID");
const results = [];
for (const item of manifest.restaurants) {
  for (const format of ["png", "svg", "pdf"]) {
    const path = artifactPath("qr", item.key + "." + format);
    const input = readFileSync(path);
    let rgba, width, height;
    if (format === "pdf") {
      const pdf = await PDFDocument.load(input);
      assert.equal(pdf.getPageCount(), 1);
      const images = pdf
        .getPage(0)
        .node.Resources()
        .lookup(PDFName.of("XObject"), PDFDict);
      const stream = images.lookup(images.keys()[0]);
      assert(stream instanceof PDFRawStream);
      assert.equal(
        stream.dict.lookup(PDFName.of("ColorSpace")).toString(),
        "/DeviceRGB",
      );
      width = stream.dict.lookup(PDFName.of("Width"), PDFNumber).asNumber();
      height = stream.dict.lookup(PDFName.of("Height"), PDFNumber).asNumber();
      const rgb = inflateSync(stream.getContents());
      rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = rgb[i * 3];
        rgba[i * 4 + 1] = rgb[i * 3 + 1];
        rgba[i * 4 + 2] = rgb[i * 3 + 2];
        rgba[i * 4 + 3] = 255;
      }
    } else {
      const img = await sharp(input)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      width = img.info.width;
      height = img.info.height;
      rgba = new Uint8ClampedArray(img.data);
    }
    const decoded = jsQR(rgba, width, height)?.data;
    assert.equal(decoded, base + item.stableRoute);
    results.push({
      restaurant: item.key,
      format,
      path,
      width,
      height,
      decodedUrl: decoded,
      decoded: true,
      publicReady: false,
      physicalScan: false,
    });
  }
}
writeFileSync(
  evidencePath("demo-qr-decoding.json"),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      projectRef,
      runId,
      base,
      status: "ARTIFACT_DECODING_ONLY",
      reason:
        "Decoding proves payload only; public HTTP resolution and physical scans require separate evidence",
      results,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    files: results.length,
    decoded: results.filter((r) => r.decoded).length,
    publicReady: false,
  }),
);
