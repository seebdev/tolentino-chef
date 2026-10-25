"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Download, Eye, FileSpreadsheet } from "lucide-react";
import type { WorkspaceData } from "@/lib/types";
import { Button, Check, Field, Notice } from "./ui";
import { DownloadLink } from "./download-link";
import {
  ImportProgress,
  readFileWithProgress,
  uploadWithProgress,
  type ImportStage,
  type TransferProgress,
} from "./import-progress";
type ImportResult = {
  headers?: string[];
  rows?: Record<string, unknown>[];
  errors?: unknown[];
  duplicates?: unknown[];
  summary?: Record<string, number>;
  message?: string;
  found?: boolean;
  status?: string;
  attemptId?: string;
};
type PendingAttempt = {
  id: string;
  fingerprint: string;
  filename: string;
  createdAt: string;
  terminal?: boolean;
};
export function ImportPanel({
  data,
  onComplete,
}: {
  data: WorkspaceData;
  onComplete: () => Promise<void>;
}) {
  const [csv, setCsv] = useState("");
  const [filename, setFilename] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({
    name: "",
    price: "",
    category: "",
    description: "",
    sku: "",
  });
  const [mode, setMode] = useState("skip"),
    [createCategories, setCreateCategories] = useState(true);
  const [preview, setPreview] = useState<ImportResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [stage, setStage] = useState<ImportStage | null>(null),
    [progress, setProgress] = useState<TransferProgress>({ loaded: 0 });
  const [pending, setPending] = useState<PendingAttempt | null>(null);
  const importInFlight = useRef(false),
    pendingRef = useRef<PendingAttempt | null>(null);
  const endpoint = "/api/workspace/" + data.restaurant.id + "/import",
    storageKey = "tolentino:import-attempt:" + data.restaurant.id;
  function remember(value: PendingAttempt) {
    localStorage.setItem(storageKey, JSON.stringify(value));
    pendingRef.current = value;
    setPending(value);
  }
  async function refreshCatalog() {
    try {
      await onComplete();
    } catch {
      setError(
        "La importación está confirmada, pero no se pudo actualizar la lista. Recarga la página.",
      );
    }
  }
  async function showResult(result: ImportResult, attempt: PendingAttempt) {
    setPreview(result);
    if (result.status === "completed" || result.status === "failed") {
      remember({ ...attempt, terminal: true });
      setError("");
      setStage(result.status === "completed" ? "complete" : "failed");
      setMessage(
        result.message || "El servidor confirmó el resultado del intento.",
      );
      setCsv("");
      setHeaders([]);
      if (result.status === "completed") await refreshCatalog();
    } else {
      setStage("recovering");
      setMessage(
        "El resultado todavía no está confirmado. Consulta de nuevo; si reenvías el mismo archivo se conservará el mismo intento. Cerrar esta página no cancela el guardado.",
      );
    }
  }
  async function lookup(attempt: PendingAttempt) {
    setStage("recovering");
    const response = await fetch(
      endpoint + "?attempt=" + encodeURIComponent(attempt.id),
      { credentials: "same-origin", cache: "no-store" },
    );
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        result.error || "No se pudo consultar el resultado del intento.",
      );
    await showResult(result, attempt);
    return result as ImportResult;
  }
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const stored = localStorage.getItem(storageKey);
        if (!stored) return;
        const attempt = JSON.parse(stored) as PendingAttempt;
        if (
          !/^[0-9a-f-]{36}$/i.test(attempt.id) ||
          typeof attempt.fingerprint !== "string"
        )
          throw new Error(
            "El identificador local del intento no es válido. No repitas la importación sin consultar con soporte.",
          );
        pendingRef.current = attempt;
        setPending(attempt);
        importInFlight.current = true;
        setBusy(true);
        lookup(attempt)
          .catch((e) => {
            if (active) setError((e as Error).message);
          })
          .finally(() => {
            if (active) {
              setBusy(false);
              importInFlight.current = false;
            }
          });
      } catch (e) {
        setError((e as Error).message);
      }
    });
    return () => {
      active = false;
    };
    // A workspace is keyed by restaurant. Recovery happens once, before any new commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  async function send(payload: Record<string, unknown>) {
    setStage("uploading");
    setProgress({ loaded: 0 });
    return uploadWithProgress<ImportResult>(endpoint, JSON.stringify(payload), {
      onProgress: setProgress,
      onUploaded: () =>
        setStage(payload.action === "commit" ? "saving" : "validating"),
    });
  }
  async function select(file: File) {
    if (importInFlight.current) return;
    setError("");
    setHeaders([]);
    setCsv("");
    setFilename("");
    setMessage("");
    setPreview(null);
    if (file.size > 5 * 1024 * 1024) {
      setError("El archivo supera el límite de 5 MB.");
      return;
    }
    importInFlight.current = true;
    setBusy(true);
    setStage("reading");
    setProgress({ loaded: 0, total: file.size });
    try {
      const text = await readFileWithProgress(file, setProgress);
      setCsv(text);
      setFilename(file.name);
      const result = await send({
        action: "preview",
        csv: text,
        mapping: {},
        mode,
        createCategories,
      });
      const cols = result.headers || [];
      setHeaders(cols);
      const aliases: Record<string, string[]> = {
        name: ["name", "nombre", "producto"],
        price: ["price", "precio"],
        category: ["category", "categoria", "categoría"],
        description: ["description", "descripcion", "descripción"],
        sku: ["sku", "codigo", "código"],
      };
      setMapping(
        Object.fromEntries(
          Object.entries(aliases).map(([key, names]) => [
            key,
            cols.find((c) => names.includes(c.toLowerCase().trim())) || "",
          ]),
        ),
      );
      setPreview(result);
      setStage(null);
    } catch (e) {
      setError((e as Error).message);
      setStage("failed");
    } finally {
      importInFlight.current = false;
      setBusy(false);
    }
  }
  async function run(action: "preview" | "commit") {
    if (importInFlight.current || !csv) return;
    importInFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const execute = async () => {
      let attempt: PendingAttempt | null = null;
      try {
        const payload = { action, csv, mapping, mode, createCategories };
        if (action === "commit") {
          const digest = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(
              JSON.stringify({
                csv,
                mapping: Object.entries(mapping).sort(([a], [b]) =>
                  a.localeCompare(b),
                ),
                mode,
                createCategories,
              }),
            ),
          );
          const fingerprint = Array.from(new Uint8Array(digest), (x) =>
            x.toString(16).padStart(2, "0"),
          ).join("");
          const persisted = localStorage.getItem(storageKey);
          const previous = persisted
            ? (JSON.parse(persisted) as PendingAttempt)
            : pendingRef.current;
          if (previous?.terminal && previous.fingerprint === fingerprint) {
            await lookup(previous);
            return;
          }
          if (previous && !previous.terminal) {
            const status = await lookup(previous);
            if (status.status === "completed" || status.status === "failed")
              return;
            if (previous.fingerprint !== fingerprint)
              throw new Error(
                "Hay un intento sin confirmar para otro archivo u otras opciones. Consulta su resultado antes de iniciar uno diferente.",
              );
            attempt = previous;
          } else
            attempt = {
              id: crypto.randomUUID(),
              fingerprint,
              filename,
              createdAt: new Date().toISOString(),
            };
          remember(attempt); // Must survive a reload before the request can reach the server.
        }
        const result = await send({
          ...payload,
          ...(attempt ? { attemptId: attempt.id } : {}),
        });
        if (attempt) await showResult(result, attempt);
        else {
          setPreview(result);
          setStage(null);
        }
      } catch (e) {
        setError((e as Error).message);
        setStage("failed");
        if (
          attempt &&
          (e as { code?: string }).code === "IMPORT_VALIDATION_REJECTED"
        ) {
          localStorage.removeItem(storageKey);
          pendingRef.current = null;
          setPending(null);
          setPreview(null);
        } else if (attempt) {
          try {
            await lookup(attempt);
          } catch {
            setMessage(
              "No se pudo recuperar la confirmación. Conservamos el identificador; consulta su estado antes de repetir.",
            );
          }
        }
      } finally {
        importInFlight.current = false;
        setBusy(false);
      }
    };
    if (navigator.locks) await navigator.locks.request(storageKey, execute);
    else await execute();
  }
  async function recover() {
    if (importInFlight.current || !pendingRef.current) return;
    importInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await lookup(pendingRef.current);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      importInFlight.current = false;
      setBusy(false);
    }
  }
  function changeMapping(key: string, value: string) {
    setMapping((m) => ({ ...m, [key]: value }));
    setPreview(null);
  }

  return (
    <section className="panel form-panel import-panel">
      <div className="section-heading">
        <h2>Importación de productos</h2>
        <p>
          Sube el archivo, revisa las columnas y valida el resultado antes de
          guardar.
        </p>
      </div>
      {stage && (
        <ImportProgress
          stage={stage}
          loaded={progress.loaded}
          total={progress.total}
        />
      )}
      {pending && !pending.terminal && (
        <div className="connection-notice">
          <p>
            Hay un intento pendiente de confirmación. Puedes volver a consultar
            su resultado o seleccionar el mismo archivo para reenviarlo con el
            mismo identificador.
          </p>
          <Button busy={busy} variant="secondary" onClick={recover}>
            Consultar resultado del intento
          </Button>
        </div>
      )}
      {error && <Notice error message={error} />}{" "}
      {message && <Notice message={message} />}
      <div className="import-steps">
        <span className="active">1. Archivo</span>
        <ArrowRight size={14} />
        <span className={headers.length ? "active" : ""}>2. Columnas</span>
        <ArrowRight size={14} />
        <span className={preview ? "active" : ""}>3. Validación</span>
      </div>
      <div className="csv-drop">
        <FileSpreadsheet size={37} strokeWidth={1.3} />
        <h3>{filename || "Trae tu carta en un archivo"}</h3>
        <p>CSV en UTF-8 · máximo 1.000 productos · 5 MB</p>
        <label className="button secondary">
          {busy ? "Procesando…" : "Seleccionar archivo"}
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void select(file);
            }}
          />
        </label>
        <DownloadLink href={endpoint} filename="plantilla-productos.csv">
          <Download size={15} />
          Descargar plantilla CSV
        </DownloadLink>
        <DownloadLink
          href={endpoint + "?download=catalog"}
          filename="catalogo-productos.csv"
        >
          <Download size={15} /> Exportar catálogo CSV
        </DownloadLink>
        <small>
          Exporta nombre, precio, categoría, descripción y SKU. Las imágenes,
          variantes y extras se administran desde Productos.
        </small>
      </div>
      {headers.length > 0 && (
        <>
          <div className="section-divider">RELACIONA LAS COLUMNAS</div>
          <div className="form-grid">
            {Object.entries({
              name: "Nombre *",
              price: "Precio *",
              category: "Categoría *",
              description: "Descripción",
              sku: "Código / SKU",
            }).map(([key, label]) => (
              <Field label={label} key={key}>
                <select
                  disabled={busy}
                  value={mapping[key]}
                  aria-label={label}
                  onChange={(e) => changeMapping(key, e.target.value)}
                >
                  <option value="">No importar</option>
                  {headers.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <Field label="Si el producto ya existe">
            <select
              disabled={busy}
              value={mode}
              aria-label="Si el producto ya existe"
              onChange={(e) => {
                setMode(e.target.value);
                setPreview(null);
              }}
            >
              <option value="skip">Omitir duplicados</option>
              <option value="update">Actualizar el producto existente</option>
            </select>
          </Field>
          <Check
            label="Crear automáticamente las categorías nuevas"
            disabled={busy}
            checked={createCategories}
            onChange={(e) => {
              setCreateCategories(e.target.checked);
              setPreview(null);
            }}
          />
          <div className="form-footer">
            <Button
              variant="secondary"
              busy={busy}
              disabled={!mapping.name || !mapping.price || !mapping.category}
              onClick={() => run("preview")}
            >
              <Eye size={17} />
              Validar y previsualizar
            </Button>
          </div>
        </>
      )}
      {preview && (
        <div className="import-result">
          <h3>Resultado de la importación</h3>
          {preview.summary && (
            <div className="import-summary">
              {Object.entries(preview.summary).map(([key, value]) => (
                <span key={key}>
                  <strong>{value}</strong>
                  {{
                    total: "Filas",
                    valid: "Válidas",
                    invalid: "Con errores",
                    duplicates: "Duplicados",
                    created: "Creados",
                    updated: "Actualizados",
                    skipped: "Omitidos",
                    rejected: "Rechazados",
                  }[key] || key}
                </span>
              ))}
            </div>
          )}
          {!!preview.errors?.length && (
            <div className="validation-errors" role="alert">
              <strong>Corrige estos errores antes de importar:</strong>
              <ul>
                {preview.errors.slice(0, 30).map((err, i) => (
                  <li key={i}>{formatImportIssue(err)}</li>
                ))}
              </ul>
            </div>
          )}
          {!!preview.duplicates?.length && (
            <div className="connection-notice">
              <strong>Coincidencias detectadas</strong>
              <ul>
                {preview.duplicates.slice(0, 30).map((item, i) => (
                  <li key={i}>{formatImportIssue(item)}</li>
                ))}
              </ul>
            </div>
          )}
          {!!preview.rows?.length && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {Object.keys(preview.rows[0]).map((key) => (
                      <th key={key}>
                        {{
                          name: "Nombre",
                          price: "Precio",
                          category: "Categoría",
                          description: "Descripción",
                          sku: "Código",
                        }[key] || key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 10).map((row, i) => (
                    <tr key={i}>
                      {Object.values(row).map((value, j) => (
                        <td key={j}>{String(value ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {csv && (
            <div className="form-footer">
              <p className="helper-text">
                El lote se guarda completo. Las traducciones tienen su progreso
                independiente en Idiomas. Se aplicarán las opciones
                seleccionadas.
              </p>
              <Button
                disabled={!!preview.errors?.length}
                busy={busy}
                onClick={() => run("commit")}
              >
                Confirmar importación <ArrowRight size={16} />
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function formatImportIssue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const issue = value as Record<string, unknown>;
    return (
      (issue.row ? "Fila " + issue.row + ": " : "") +
      String(issue.message || issue.name || "Revisa este registro.")
    );
  }
  return "Revisa este registro.";
}
