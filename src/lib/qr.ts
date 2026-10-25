import QRCode from "qrcode";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import jsQR from "jsqr";
import { z } from "zod";

export type QrFrame = "none" | "simple" | "rounded";
export type QrFormat = "png" | "svg" | "pdf";
export type GenerateQrOptions = {
  url: string;
  foreground?: string;
  background?: string;
  label?: string;
  frame?: QrFrame | string;
  logo?: Buffer;
  format: QrFormat;
  size?: number;
  export_size?: number;
  logo_size?: number;
  font_family?: "sans" | "serif" | "mono";
  module_style?: "square" | "rounded";
};

export const qrInput = z.object({
  foreground: z.string().regex(/^#[a-f0-9]{6}$/i),
  background: z.string().regex(/^#[a-f0-9]{6}$/i),
  frame: z.enum(["none", "simple", "rounded"]),
  label: z.string().max(80),
  include_logo: z.boolean(),
  config_version: z.number().int().positive().default(1),
  logo_size: z.number().int().min(8).max(14).default(14),
  font_family: z.enum(["sans", "serif", "mono"]).default("sans"),
  export_size: z
    .union([z.literal(256), z.literal(512), z.literal(1024), z.literal(2048)])
    .default(1024),
  module_style: z.enum(["square", "rounded"]).default("square"),
});

export const QR_LIMITS = Object.freeze({
  quietZoneModules: 4,
  errorCorrection: "H" as const,
  minimumContrast: 7,
  maximumLabelCharacters: 80,
  maximumLogoBytes: 5 * 1024 * 1024,
  maximumLogoPixels: 16_000_000,
  maximumLogoPlateSideRatio: 0.14,
  minimumSize: 256,
  maximumSize: 2048,
});

function luminance(hex: string): number {
  const rgb = [1, 3, 5].map(
    (offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const linear = rgb.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

export function qrContrastRatio(
  foreground: string,
  background: string,
): number {
  if (
    ![foreground, background].every((value) => /^#[\da-f]{6}$/i.test(value))
  ) {
    throw new Error("Los colores QR deben tener formato hexadecimal #RRGGBB.");
  }
  const foregroundLight = luminance(foreground);
  const backgroundLight = luminance(background);
  return (
    (Math.max(foregroundLight, backgroundLight) + 0.05) /
    (Math.min(foregroundLight, backgroundLight) + 0.05)
  );
}

export function validateQrColors(foreground: string, background: string): void {
  const contrast = qrContrastRatio(foreground, background);
  if (
    contrast < QR_LIMITS.minimumContrast ||
    luminance(foreground) >= luminance(background)
  ) {
    throw new Error(
      "El QR necesita módulos oscuros, fondo claro y contraste mínimo 7:1.",
    );
  }
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character]!,
  );
}

function validate(options: GenerateQrOptions) {
  const foreground = options.foreground ?? "#173c2d";
  const background = options.background ?? "#ffffff";
  validateQrColors(foreground, background);
  if (!["png", "svg", "pdf"].includes(options.format))
    throw new Error("Formato QR no admitido.");
  const size = options.size ?? options.export_size ?? 1024;
  if (
    !Number.isInteger(size) ||
    size < QR_LIMITS.minimumSize ||
    size > QR_LIMITS.maximumSize
  ) {
    throw new Error(
      "El tamaño QR debe ser un entero entre 256 y 2048 píxeles.",
    );
  }
  const frame = options.frame ?? "simple";
  if (!["none", "simple", "rounded"].includes(frame))
    throw new Error("Marco QR no admitido.");
  const logoSize = options.logo_size ?? 14;
  if (!Number.isInteger(logoSize) || logoSize < 8 || logoSize > 14)
    throw Error(
      "El tamaño del logo debe estar entre 8 y 14% del lado del símbolo.",
    );
  const font = options.font_family ?? "sans";
  if (!["sans", "serif", "mono"].includes(font))
    throw Error("Tipografía QR no admitida.");
  const moduleStyle = options.module_style ?? "square";
  if (!["square", "rounded"].includes(moduleStyle))
    throw Error("Estilo de módulos QR no admitido.");
  const label = (options.label ?? "").trim();
  const hasControlCharacter = Array.from(label).some((character) => {
    const code = character.codePointAt(0)!;
    return code < 32 || (code >= 127 && code <= 159);
  });
  if (
    Array.from(label).length > QR_LIMITS.maximumLabelCharacters ||
    hasControlCharacter
  ) {
    throw new Error(
      "El texto QR admite hasta 80 caracteres y no admite caracteres de control.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(options.url);
  } catch {
    throw new Error("El destino QR debe ser una URL absoluta.");
  }
  if (
    !["https:", "http:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    options.url.length > 512
  ) {
    throw new Error(
      "El destino QR debe ser HTTP(S), sin credenciales y de hasta 512 caracteres.",
    );
  }
  if (
    parsed.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  )
    throw Error("El destino permanente QR debe usar HTTPS.");
  return {
    foreground,
    background,
    frame,
    label,
    size,
    logoSize,
    font,
    moduleStyle,
  };
}

function wrapLabel(label: string, maxCharacters = 28): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of label.split(/\s+/).filter(Boolean)) {
    const characters = Array.from(word);
    if (characters.length > maxCharacters) {
      if (line) {
        lines.push(line);
        line = "";
      }
      for (let index = 0; index < characters.length; index += maxCharacters)
        lines.push(characters.slice(index, index + maxCharacters).join(""));
    } else if (
      Array.from(line ? `${line} ${word}` : word).length > maxCharacters
    ) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

async function safeLogo(buffer: Buffer): Promise<Buffer> {
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length === 0 ||
    buffer.length > QR_LIMITS.maximumLogoBytes
  ) {
    throw new Error("El logo QR debe ser una imagen de hasta 5 MB.");
  }
  // Only raster signatures are accepted; SVG can reference external resources.
  const png = buffer
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const webp =
    buffer.subarray(0, 4).toString() === "RIFF" &&
    buffer.subarray(8, 12).toString() === "WEBP";
  if (!png && !jpeg && !webp)
    throw new Error("El logo QR debe ser PNG, JPEG o WebP.");
  try {
    return await sharp(buffer, {
      limitInputPixels: QR_LIMITS.maximumLogoPixels,
      animated: false,
    })
      .rotate()
      .resize(256, 256, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    throw new Error(
      "No se pudo leer el logo QR o excede el límite de resolución.",
    );
  }
}

/** Encodes the supplied permanent URL verbatim; this function never creates or changes tokens. */
export async function generateQr(
  options: GenerateQrOptions,
): Promise<Buffer | string> {
  const {
    foreground,
    background,
    frame,
    label,
    size,
    logoSize,
    font,
    moduleStyle,
  } = validate(options);
  const qr = QRCode.create(options.url, {
    errorCorrectionLevel: QR_LIMITS.errorCorrection,
  });
  const lineSize = Math.max(11, Math.round(size * 0.04));
  const labelLines = wrapLabel(label);
  const labelHeight = labelLines.length
    ? labelLines.length * lineSize * 1.25 + size * 0.025
    : 0;
  const outerPadding = Math.max(8, Math.round(size * 0.035));
  const available = Math.floor(size - outerPadding * 2 - labelHeight);
  const moduleSize = Math.floor(
    available / (qr.modules.size + QR_LIMITS.quietZoneModules * 2),
  );
  if (moduleSize < 2)
    throw new Error(
      "El destino o el texto es demasiado largo para este tamaño QR; usa una URL más corta o mayor tamaño.",
    );
  const qrSide = moduleSize * qr.modules.size;
  const quietZone = moduleSize * QR_LIMITS.quietZoneModules;
  const completeSide = qrSide + quietZone * 2;
  const symbolLeft = Math.floor((size - completeSide) / 2);
  const symbolTop = outerPadding + Math.floor((available - completeSide) / 2);
  const left = symbolLeft + quietZone;
  const top = symbolTop + quietZone;
  const path: string[] = [];
  const rounded: string[] = [];
  for (let row = 0; row < qr.modules.size; row++) {
    for (let column = 0; column < qr.modules.size; column++) {
      if (qr.modules.get(row, column)) {
        // Finder, timing, alignment and format/version patterns retain their exact squares.
        if (moduleStyle === "rounded" && !qr.modules.isReserved(row, column))
          rounded.push(
            `<rect x="${left + column * moduleSize}" y="${top + row * moduleSize}" width="${moduleSize}" height="${moduleSize}" rx="${moduleSize * 0.18}"/>`,
          );
        else
          path.push(
            `M${left + column * moduleSize},${top + row * moduleSize}h${moduleSize}v${moduleSize}h-${moduleSize}z`,
          );
      }
    }
  }
  let logoMarkup = "";
  if (options.logo) {
    const logoPng = await safeLogo(options.logo);
    const plateSide = Math.floor((qrSide * logoSize) / 100);
    const logoSide = Math.max(
      1,
      plateSide - Math.max(4, Math.ceil(moduleSize * 0.7)) * 2,
    );
    const plateLeft = left + (qrSide - plateSide) / 2;
    const plateTop = top + (qrSide - plateSide) / 2;
    logoMarkup = `<rect x="${plateLeft}" y="${plateTop}" width="${plateSide}" height="${plateSide}" fill="${background}"/><image x="${left + (qrSide - logoSide) / 2}" y="${top + (qrSide - logoSide) / 2}" width="${logoSide}" height="${logoSide}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${logoPng.toString("base64")}"/>`;
    // A centered alignment pattern occurs in some QR versions. Restore reserved
    // cells over the logo, including white cells, rather than obscuring it.
    for (let row = 0; row < qr.modules.size; row++)
      for (let column = 0; column < qr.modules.size; column++) {
        const x = left + column * moduleSize,
          y = top + row * moduleSize;
        if (
          qr.modules.isReserved(row, column) &&
          x + moduleSize > plateLeft &&
          x < plateLeft + plateSide &&
          y + moduleSize > plateTop &&
          y < plateTop + plateSide
        )
          logoMarkup += `<rect x="${x}" y="${y}" width="${moduleSize}" height="${moduleSize}" fill="${qr.modules.get(row, column) ? foreground : background}"/>`;
      }
  }
  const strokeWidth = Math.max(1, Math.round(size / 256));
  const inset = Math.ceil(strokeWidth * 2);
  const frameMarkup =
    frame === "none"
      ? ""
      : `<rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" rx="${frame === "rounded" ? size * 0.045 : 0}" fill="none" stroke="${foreground}" stroke-width="${strokeWidth}"/>`;
  const labelMarkup = labelLines
    .map((line, index) => {
      // A full-width glyph budget keeps long Latin and CJK lines inside the frame.
      const fontSize = Math.min(
        lineSize,
        (size - outerPadding * 2) /
          (Math.max(1, Array.from(line).length) * 1.05),
      );
      return `<text x="${size / 2}" y="${size - outerPadding - (labelLines.length - 1 - index) * lineSize * 1.25}" text-anchor="middle" font-family="${{ sans: "Arial, sans-serif", serif: "Georgia, serif", mono: "Courier New, monospace" }[font]}" font-size="${fontSize}" font-weight="600" fill="${foreground}">${escapeXml(line)}</text>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Código QR del menú"><rect width="${size}" height="${size}" fill="${background}"/>${frameMarkup}<path d="${path.join("")}" fill="${foreground}" shape-rendering="crispEdges"/><g fill="${foreground}">${rounded.join("")}</g>${logoMarkup}${labelMarkup}</svg>`;
  if (options.format === "svg") {
    await validateQrArtifact(svg, "svg", options.url, [
      size,
      Math.max(256, Math.round(size * 0.75)),
    ]);
    return svg;
  }
  const raster = await sharp(Buffer.from(svg), { limitInputPixels: 5_000_000 })
    .png()
    .toBuffer();
  if (options.format === "png") {
    await validateQrArtifact(raster, "png", options.url, [
      size,
      Math.max(256, Math.round(size * 0.75)),
    ]);
    return raster;
  }
  const document = await PDFDocument.create();
  document.setTitle("QR del menú");
  document.setSubject("Código QR permanente del restaurante");
  const page = document.addPage([288, 288]);
  const embedded = await document.embedPng(raster);
  page.drawImage(embedded, { x: 0, y: 0, width: 288, height: 288 });
  const pdf = Buffer.from(await document.save());
  await validateQrArtifact(pdf, "pdf", options.url, [
    size,
    Math.max(256, Math.round(size * 0.75)),
  ]);
  return pdf;
}

let rendering: Promise<void> = Promise.resolve();
let queued = 0;
/** Serializes native canvas buffers to bound renderer memory on the Free instance. */
async function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  if (queued >= 8)
    throw Error(
      "La validación QR está ocupada. Inténtalo de nuevo en unos segundos.",
    );
  queued++;
  const previous = rendering;
  let unlock!: () => void;
  rendering = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  await previous;
  try {
    return await work();
  } finally {
    queued--;
    unlock();
  }
}

/** Rasterizes the actual PDF page, including its transforms, clipping and overlays. */
export async function rasterizeQrPdf(
  input: Buffer,
  size: number,
): Promise<Buffer> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(input),
    useSystemFonts: false,
    useWorkerFetch: false,
    maxImageSize: 5_000_000,
  });
  const document = await task.promise;
  try {
    if (document.numPages !== 1)
      throw Error("El PDF QR debe contener una página.");
    const page = await document.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: size / Math.max(base.width, base.height),
    });
    const canvas = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: canvas.getContext(
        "2d",
      ) as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    return canvas.toBuffer("image/png");
  } finally {
    await task.destroy();
  }
}

export async function validateQrArtifact(
  input: Buffer | string,
  format: QrFormat,
  url: string,
  sizes: number[] = [512, 384],
) {
  const bytes = typeof input === "string" ? Buffer.from(input) : input;
  if (bytes.length > 10 * 1024 * 1024)
    throw Error("El artefacto QR excede el límite permitido.");
  if (
    sizes.some((size) => !Number.isInteger(size) || size < 256 || size > 2048)
  )
    throw Error("Tamaño de validación QR no permitido.");
  return oneAtATime(async () => {
    const checked = [];
    for (const size of [...new Set(sizes)]) {
      const raster =
        format === "pdf"
          ? await rasterizeQrPdf(bytes, size)
          : await sharp(bytes, { limitInputPixels: 5_000_000 })
              .resize(size, size, { fit: "contain", background: "#ffffff" })
              .png()
              .toBuffer();
      const { data, info } = await sharp(raster)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const decoded = jsQR(
        new Uint8ClampedArray(data),
        info.width,
        info.height,
        { inversionAttempts: "dontInvert" },
      );
      if (decoded?.data !== url)
        throw Error(
          "No se pudo decodificar el diseño final. Reduce el logo o texto, usa módulos cuadrados o aumenta el tamaño. Se conserva el último diseño guardado.",
        );
      checked.push({ width: info.width, height: info.height });
    }
    return {
      valid: true as const,
      source:
        format === "pdf"
          ? "rendered-pdf-page"
          : format === "svg"
            ? "rasterized-svg"
            : "final-png",
      sizes: checked,
      physicalScan: false as const,
    };
  });
}
