import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { generateQr, validateQrArtifact } from "../src/lib/qr";
const url =
  "https://tolentino-restaurantes-admin.onrender.com/q/4bd972ac-3fca-4b78-a57d-b26d760f331e";
describe("composed QR closure regression", () => {
  it("rejects an excessive logo allowance instead of silently ignoring configuration", async () => {
    await expect(
      generateQr({ url, format: "png", logo_size: 40 }),
    ).rejects.toThrow(/logo/i);
  });
  it("restricts export URLs to HTTPS outside loopback", async () => {
    await expect(
      generateQr({ url: "http://example.com/q/a", format: "png" }),
    ).rejects.toThrow(/HTTPS/);
  });
  it("rejects injected font or unsupported module style", async () => {
    await expect(
      generateQr({ url, format: "svg", font_family: "url(evil)" as never }),
    ).rejects.toThrow();
    await expect(
      generateQr({ url, format: "svg", module_style: "malicious" as never }),
    ).rejects.toThrow();
  });
  for (const size of [256, 512, 1024])
    for (const format of ["png", "svg", "pdf"] as const)
      it(`validates final ${format} at ${size}px with a logo, text, frame and rounded data modules`, async () => {
        const logo = await sharp({
          create: { width: 70, height: 50, channels: 4, background: "#c77227" },
        })
          .png()
          .toBuffer();
        const result = await generateQr({
          url,
          format,
          size,
          logo,
          logo_size: 12,
          font_family: "serif",
          module_style: "rounded",
          frame: "rounded",
          label: "Nuestro menú",
        });
        const validation = await validateQrArtifact(result, format, url, [
          size,
          Math.max(256, Math.round(size * 0.75)),
        ]);
        expect(validation.valid).toBe(true);
        expect(validation.source).toBe(
          format === "pdf"
            ? "rendered-pdf-page"
            : format === "svg"
              ? "rasterized-svg"
              : "final-png",
        );
        expect(validation.physicalScan).toBe(false);
      }, 30000);
  it("rejects a final artifact that has no readable symbol", async () => {
    const empty = await sharp({
      create: { width: 512, height: 512, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    await expect(validateQrArtifact(empty, "png", url)).rejects.toThrow(
      /lectura|decodificar/,
    );
  });
});
