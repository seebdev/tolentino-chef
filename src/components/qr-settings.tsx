"use client";
import { useEffect, useRef, useState } from "react";
import {
  Check as CheckIcon,
  Copy,
  Download,
  ExternalLink,
  QrCode,
} from "lucide-react";
import type { QrConfig, WorkspaceData } from "@/lib/types";
import type { Mutate } from "./workspace";
import { Button, Check, Field, Notice } from "./ui";
import { DownloadLink } from "./download-link";

function normalized(input: QrConfig | null | undefined): QrConfig {
  return {
    foreground: input?.foreground ?? "#163c2c",
    background: input?.background ?? "#ffffff",
    frame: input?.frame ?? "simple",
    label: input?.label ?? "Descubre nuestro menú",
    include_logo: input?.include_logo ?? false,
    config_version: input?.config_version ?? 1,
    logo_size: input?.logo_size ?? 14,
    font_family: input?.font_family ?? "sans",
    export_size: input?.export_size ?? 1024,
    module_style: input?.module_style ?? "square",
  };
}
export function QrPanel({
  data,
  mutate,
  busy,
  support,
}: {
  data: WorkspaceData;
  mutate: Mutate;
  busy: boolean;
  support: boolean;
}) {
  const [config, setConfig] = useState(() => normalized(data.qr));
  const [saved, setSaved] = useState(() => normalized(data.qr));
  const [downloadSize, setDownloadSize] = useState<number>(
    config.export_size ?? 1024,
  );
  const [preview, setPreview] = useState("");
  const [validKey, setValidKey] = useState("");
  const [error, setError] = useState("");
  const [canonical, setCanonical] = useState("");
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(true);
  const sequence = useRef(0),
    objectUrl = useRef("");
  const endpoint = "/api/workspace/" + data.restaurant.id + "/qr";
  const configKey = JSON.stringify(config),
    savedKey = JSON.stringify(saved),
    dirty = configKey !== savedKey;
  const requestKey =
    configKey + ":" + (support ? config.export_size : downloadSize);
  useEffect(() => {
    const controller = new AbortController(),
      request = ++sequence.current;
    // The timer coalesces edits. It does not simulate transfer or validation progress.
    const timer = window.setTimeout(
      async () => {
        setGenerating(true);
        setError("");
        try {
          const response = await fetch(
            endpoint + (support ? "" : "?format=svg&size=" + downloadSize),
            {
              method: support ? "POST" : "GET",
              credentials: "same-origin",
              cache: "no-store",
              signal: controller.signal,
              headers: support
                ? { "Content-Type": "application/json" }
                : undefined,
              body: support ? configKey : undefined,
            },
          );
          if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || "No se pudo validar el diseño QR.");
          }
          if (response.headers.get("X-QR-Validated") !== "true")
            throw new Error("El servidor no confirmó la validación del QR.");
          const blob = await response.blob();
          if (controller.signal.aborted || request !== sequence.current) return;
          const permanent = response.headers.get("X-QR-Permanent-URL");
          if (!permanent)
            throw new Error("No se recibió la dirección permanente del QR.");
          const nextUrl = URL.createObjectURL(blob),
            previous = objectUrl.current;
          objectUrl.current = nextUrl;
          setPreview(nextUrl);
          setCanonical(permanent);
          setValidKey(requestKey);
          if (previous) URL.revokeObjectURL(previous);
        } catch (e) {
          if (!controller.signal.aborted && request === sequence.current)
            setError((e as Error).message);
        } finally {
          if (!controller.signal.aborted && request === sequence.current)
            setGenerating(false);
        }
      },
      support ? 300 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [endpoint, support, configKey, downloadSize, requestKey]);
  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );
  const validated = validKey === requestKey && !error && !generating;
  async function save() {
    if (!validated || busy) return;
    const submitted = { ...config };
    if (await mutate("save_qr", submitted)) {
      const next = {
        ...submitted,
        config_version: (submitted.config_version ?? 1) + 1,
      };
      setSaved(next);
      setConfig(next);
    }
  }
  async function copy() {
    try {
      if (canonical) {
        await navigator.clipboard.writeText(canonical);
        setCopied(true);
      }
    } catch {
      setError(
        "No se pudo copiar. Abre el enlace permanente y cópialo desde el navegador.",
      );
    }
  }
  return (
    <div className="settings-two-column">
      <section className="panel form-panel">
        <div className="section-heading">
          <h2>Un código, siempre conectado</h2>
          <p>
            Este QR usa una dirección permanente de Tolentino para abrir tu menú
            actual.
          </p>
        </div>
        {error && <Notice error message={error} />}
        {support ? (
          <fieldset
            disabled={busy}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <div className="form-grid">
              <Field label="Color del código">
                <input
                  type="color"
                  value={config.foreground}
                  onChange={(e) =>
                    setConfig({ ...config, foreground: e.target.value })
                  }
                />
              </Field>
              <Field label="Color del fondo">
                <input
                  type="color"
                  value={config.background}
                  onChange={(e) =>
                    setConfig({ ...config, background: e.target.value })
                  }
                />
              </Field>
            </div>
            <Field label="Marco">
              <select
                value={config.frame}
                onChange={(e) =>
                  setConfig({ ...config, frame: e.target.value })
                }
              >
                <option value="none">Sin marco</option>
                <option value="simple">Clásico</option>
                <option value="rounded">Redondeado</option>
              </select>
            </Field>
            <Field label="Texto del QR">
              <input
                value={config.label}
                maxLength={80}
                onChange={(e) =>
                  setConfig({ ...config, label: e.target.value })
                }
              />
            </Field>
            <Field label="Tipografía del QR">
              <select
                value={config.font_family}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    font_family: e.target.value as QrConfig["font_family"],
                  })
                }
              >
                <option value="sans">Sans serif</option>
                <option value="serif">Serif</option>
                <option value="mono">Monoespaciada</option>
              </select>
            </Field>
            <Field label="Estilo de módulos">
              <select
                value={config.module_style}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    module_style: e.target.value as QrConfig["module_style"],
                  })
                }
              >
                <option value="square">Cuadrados</option>
                <option value="rounded">
                  Suaves; patrones de lectura cuadrados
                </option>
              </select>
            </Field>
            <Check
              label="Incluir el logo del restaurante"
              checked={config.include_logo}
              disabled={!data.settings.appearance?.logo_path}
              onChange={(e) =>
                setConfig({ ...config, include_logo: e.target.checked })
              }
            />
            {config.include_logo && (
              <Field
                label="Tamaño del logo (%)"
                hint="Entre 8 y 14 % del lado del código; con placa de contraste."
              >
                <input
                  type="number"
                  min={8}
                  max={14}
                  value={config.logo_size}
                  onChange={(e) =>
                    setConfig({ ...config, logo_size: Number(e.target.value) })
                  }
                />
              </Field>
            )}
            <Field label="Tamaño de exportación">
              <select
                value={config.export_size}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    export_size: Number(
                      e.target.value,
                    ) as QrConfig["export_size"],
                  })
                }
              >
                {[256, 512, 1024, 2048].map((size) => (
                  <option key={size} value={size}>
                    {size} × {size} px
                  </option>
                ))}
              </select>
            </Field>
            <p className="helper-text">
              El servidor comprueba contraste, zona de silencio y lectura del
              archivo final. Al guardar valida PNG, SVG y la página PDF
              renderizada.
            </p>
            <div className="form-footer">
              <Button
                busy={busy}
                disabled={!validated || !dirty}
                onClick={save}
              >
                Guardar diseño
              </Button>
            </div>
          </fieldset>
        ) : (
          <>
            <div className="connection-notice">
              <QrCode size={21} />
              <p>
                Descarga el diseño validado. Tolentino puede ayudarte a
                personalizarlo.
              </p>
            </div>
            <Field label="Tamaño de exportación">
              <select
                value={downloadSize}
                onChange={(e) => setDownloadSize(Number(e.target.value))}
              >
                {[256, 512, 1024, 2048].map((size) => (
                  <option key={size} value={size}>
                    {size} × {size} px
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        <div className="section-divider">ENLACE PERMANENTE</div>
        <div className="copy-link">
          {canonical ? (
            <a href={canonical} target="_blank" rel="noreferrer">
              Abrir enlace del QR <ExternalLink size={14} />
            </a>
          ) : (
            <span>Comprobando dirección permanente…</span>
          )}
          <button
            className="icon-button"
            onClick={copy}
            disabled={!canonical}
            aria-label="Copiar enlace permanente"
          >
            {copied ? <CheckIcon size={18} /> : <Copy size={18} />}
          </button>
        </div>
        <small className="helper-text">
          El identificador permanece al cambiar el nombre, la dirección o el
          diseño.
        </small>
      </section>
      <section className="panel qr-display">
        <span className="eyebrow">TU MENÚ A UN ESCANEO</span>
        <div className="qr-image">
          {preview && <img src={preview} alt="Código QR del restaurante" />}
        </div>
        <p role="status" aria-live="polite">
          {generating || (validKey !== requestKey && !error)
            ? "Generando y comprobando el diseño…"
            : error
              ? "Diseño no validado. Se conserva la última vista válida."
              : "Validación automática completada."}
        </p>
        <h3>{data.restaurant.name}</h3>
        {dirty && (
          <p>Guarda el diseño validado para habilitar sus descargas.</p>
        )}
        <div className="qr-downloads">
          {["png", "svg", "pdf"].map((format) =>
            validated && !dirty ? (
              <DownloadLink
                className="button secondary small"
                key={format}
                href={
                  endpoint +
                  "?format=" +
                  format +
                  "&size=" +
                  (support ? config.export_size : downloadSize)
                }
                filename={"qr-" + data.restaurant.slug + "." + format}
              >
                <Download size={15} />
                {format.toUpperCase()}
              </DownloadLink>
            ) : (
              <button key={format} className="button secondary small" disabled>
                {format.toUpperCase()}
              </button>
            ),
          )}
        </div>
        <small>
          Prueba física pendiente: escanéalo con un teléfono y comprueba una
          impresión antes de distribuirlo.
        </small>
      </section>
    </div>
  );
}
