import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import sharp from "sharp";
import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
} from "pdf-lib";
import { inflateSync } from "node:zlib";
import { generateQr, qrContrastRatio, QR_LIMITS } from "../src/lib/qr";

const permanentUrl =
  "https://menu.example.com/q/4bd972ac-3fca-4b78-a57d-b26d760f331e";
const defaults = {
  url: permanentUrl,
  foreground: "#173c2d",
  background: "#ffffff",
  label: "Escanea nuestro menú",
  frame: "rounded" as const,
};

function decodePng(buffer: Buffer) {
  const png = PNG.sync.read(buffer);
  return {
    width: png.width,
    height: png.height,
    decoded: jsQR(new Uint8ClampedArray(png.data), png.width, png.height, {
      inversionAttempts: "dontInvert",
    })?.data,
  };
}

async function demoLogo() {
  return sharp({
    create: { width: 90, height: 60, channels: 4, background: "#c77227" },
  })
    .png()
    .toBuffer();
}

describe("QR exports independently decoded", () => {
  for (const size of [256, 512, 1024]) {
    for (const withLogo of [false, true]) {
      it(`preserves the exact URL at ${size}px ${withLogo ? "with" : "without"} logo`, async () => {
        const png = await generateQr({
          ...defaults,
          size,
          format: "png",
          ...(withLogo ? { logo: await demoLogo() } : {}),
        });
        expect(Buffer.isBuffer(png)).toBe(true);
        expect(decodePng(png as Buffer)).toEqual({
          width: size,
          height: size,
          decoded: permanentUrl,
        });
      });
    }
  }

  it("keeps the public token unchanged after colors, frame, label and logo change", async () => {
    const versions = [
      {
        foreground: "#000000",
        background: "#ffffff",
        frame: "none",
        label: "",
      },
      {
        foreground: "#111827",
        background: "#f5f1e8",
        frame: "simple",
        label: "Ver nuestra carta",
        logo: await demoLogo(),
      },
      {
        foreground: "#173c2d",
        background: "#ffffff",
        frame: "rounded",
        label: "Nuevo nombre del restaurante",
      },
    ];
    for (const appearance of versions) {
      const png = await generateQr({
        url: permanentUrl,
        ...appearance,
        format: "png",
        size: 512,
      });
      const decoded = decodePng(png as Buffer).decoded;
      expect(decoded).toBe(permanentUrl);
      expect(new URL(decoded!).pathname).toBe(
        "/q/4bd972ac-3fca-4b78-a57d-b26d760f331e",
      );
    }
  });

  it("embeds an escaped label and sanitized raster logo in a decodable SVG", async () => {
    const svg = await generateQr({
      ...defaults,
      label: '<Menu & "café">',
      logo: await demoLogo(),
      format: "svg",
      size: 512,
    });
    expect(typeof svg).toBe("string");
    expect(svg).toContain("&lt;Menu &amp; &quot;café&quot;&gt;");
    expect(svg).toContain('href="data:image/png;base64,');
    expect(svg).not.toContain("<Menu");
    const png = await sharp(Buffer.from(svg as string))
      .png()
      .toBuffer();
    expect(decodePng(png).decoded).toBe(permanentUrl);
  });

  it("PDF contains the same complete decodable QR image with label, frame and logo", async () => {
    const options = { ...defaults, size: 512, logo: await demoLogo() };
    const expectedPng = PNG.sync.read(
      (await generateQr({ ...options, format: "png" })) as Buffer,
    );
    const pdf = await PDFDocument.load(
      (await generateQr({ ...options, format: "pdf" })) as Buffer,
    );
    expect(pdf.getPageCount()).toBe(1);
    const page = pdf.getPage(0);
    expect(page.getSize()).toEqual({ width: 288, height: 288 });
    const resources = page.node.Resources()!;
    const images = resources.lookup(PDFName.of("XObject"), PDFDict);
    const stream = images.lookup(images.keys()[0]);
    if (!(stream instanceof PDFRawStream))
      throw new Error("PDF image is not a raw image stream");
    const width = stream.dict.lookup(PDFName.of("Width"), PDFNumber).asNumber();
    const height = stream.dict
      .lookup(PDFName.of("Height"), PDFNumber)
      .asNumber();
    const bytes = inflateSync(stream.getContents());
    expect(stream.dict.lookup(PDFName.of("ColorSpace"))).toEqual(
      PDFName.of("DeviceRGB"),
    );
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel++) {
      rgba[pixel * 4] = bytes[pixel * 3];
      rgba[pixel * 4 + 1] = bytes[pixel * 3 + 1];
      rgba[pixel * 4 + 2] = bytes[pixel * 3 + 2];
      rgba[pixel * 4 + 3] = 255;
    }
    expect(Buffer.from(rgba)).toEqual(expectedPng.data);
    expect(jsQR(rgba, width, height)?.data).toBe(permanentUrl);
  });

  it("reserves at least four empty modules and ECC H", async () => {
    expect(QR_LIMITS.quietZoneModules).toBeGreaterThanOrEqual(4);
    expect(QR_LIMITS.errorCorrection).toBe("H");
    const png = PNG.sync.read(
      (await generateQr({
        ...defaults,
        frame: "none",
        label: "",
        size: 512,
        format: "png",
      })) as Buffer,
    );
    // Detect the top-left finder. Its first dark run is exactly seven modules.
    let firstRow = -1;
    let firstColumn = -1;
    for (let y = 0; y < png.height && firstRow < 0; y++) {
      for (let x = 0; x < png.width; x++) {
        if (png.data[(y * png.width + x) * 4] < 100) {
          firstRow = y;
          firstColumn = x;
          break;
        }
      }
    }
    let run = 0;
    while (png.data[(firstRow * png.width + firstColumn + run) * 4] < 100)
      run++;
    const moduleSize = run / 7;
    expect(Number.isInteger(moduleSize)).toBe(true);
    for (let y = firstRow - moduleSize * 4; y < firstRow; y++) {
      for (
        let x = firstColumn - moduleSize * 4;
        x < png.width - firstColumn + moduleSize * 4;
        x++
      ) {
        expect(png.data[(y * png.width + x) * 4]).toBe(255);
      }
    }
  });
});

describe("QR validation", () => {
  it("calculates contrast and rejects weak or inverted colors", async () => {
    expect(qrContrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
    await expect(
      generateQr({ ...defaults, foreground: "#888888", format: "png" }),
    ).rejects.toThrow("contraste");
    await expect(
      generateQr({
        ...defaults,
        foreground: "#ffffff",
        background: "#000000",
        format: "png",
      }),
    ).rejects.toThrow("contraste");
    await expect(
      generateQr({
        ...defaults,
        foreground: "url(https://invalid)",
        format: "svg",
      }),
    ).rejects.toThrow("hexadecimal");
  });

  it("rejects unsafe destinations, oversized label and invalid dimensions", async () => {
    for (const url of [
      "javascript:alert(1)",
      "/q/token",
      "https://user:secret@example.com/q/token",
    ]) {
      await expect(
        generateQr({ ...defaults, url, format: "svg" }),
      ).rejects.toThrow();
    }
    await expect(
      generateQr({ ...defaults, label: "a".repeat(81), format: "png" }),
    ).rejects.toThrow("80");
    await expect(
      generateQr({ ...defaults, label: "Menú\u0000", format: "png" }),
    ).rejects.toThrow("control");
    for (const size of [128, 4096, 512.5])
      await expect(
        generateQr({ ...defaults, size, format: "png" }),
      ).rejects.toThrow("tamaño");
    await expect(
      generateQr({ ...defaults, frame: "<script>", format: "svg" }),
    ).rejects.toThrow("Marco");
  });

  it("rejects SVG or non-image logos and bounds bytes", async () => {
    await expect(
      generateQr({ ...defaults, logo: Buffer.from("<svg/>"), format: "png" }),
    ).rejects.toThrow("PNG");
    await expect(
      generateQr({
        ...defaults,
        logo: Buffer.alloc(QR_LIMITS.maximumLogoBytes + 1),
        format: "png",
      }),
    ).rejects.toThrow("5 MB");
  });

  it("accepts the maximum label at the minimum size while retaining a decodable symbol", async () => {
    const png = await generateQr({
      ...defaults,
      label: "W".repeat(80),
      size: 256,
      format: "png",
      logo: await demoLogo(),
    });
    expect(decodePng(png as Buffer).decoded).toBe(permanentUrl);
  });
});
