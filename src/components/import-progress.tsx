"use client";
import styles from "./import-progress.module.css";

export type TransferProgress = { loaded: number; total?: number };
export type ImportStage =
  | "reading"
  | "uploading"
  | "validating"
  | "saving"
  | "recovering"
  | "complete"
  | "failed";
const labels: Record<ImportStage, string> = {
  reading: "Leyendo archivo",
  uploading: "Subiendo archivo",
  validating: "Validando productos",
  saving: "Guardando productos",
  recovering: "Consultando el resultado del intento",
  complete: "Importación confirmada",
  failed: "No se pudo confirmar la importación",
};
export function ImportProgress({
  stage,
  label,
  loaded,
  total,
}: {
  stage: ImportStage;
  label?: string;
  loaded?: number;
  total?: number;
}) {
  const measurable =
    ["reading", "uploading"].includes(stage) &&
    typeof loaded === "number" &&
    typeof total === "number" &&
    total > 0;
  const percent = measurable
    ? Math.min(100, Math.floor((100 * loaded!) / total!))
    : stage === "complete"
      ? 100
      : undefined;
  const text = label || labels[stage];
  return (
    <div className={styles.progress} role="status" aria-live="polite">
      <div
        role="progressbar"
        aria-label={text}
        aria-valuemin={percent === undefined ? undefined : 0}
        aria-valuemax={percent === undefined ? undefined : 100}
        aria-valuenow={percent}
        className={styles.circle}
      >
        <svg
          viewBox="0 0 48 48"
          aria-hidden="true"
          className={
            percent === undefined && stage !== "failed"
              ? styles.indeterminate
              : ""
          }
        >
          <circle
            cx="24"
            cy="24"
            r="19"
            fill="none"
            stroke="currentColor"
            opacity=".15"
            strokeWidth="4"
          />
          <circle
            cx="24"
            cy="24"
            r="19"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            pathLength="100"
            strokeDasharray={`${percent ?? 24} 100`}
            transform="rotate(-90 24 24)"
          />
        </svg>
        {percent !== undefined && <span>{percent}%</span>}
      </div>
      <div>
        <strong>{text}</strong>
        {measurable && (
          <small>
            {loaded!.toLocaleString()} de {total!.toLocaleString()} bytes
          </small>
        )}
        {stage === "saving" && (
          <small>
            El lote se confirma completo en la base de datos. Subir el archivo
            no significa que ya esté guardado.
          </small>
        )}
        {stage === "recovering" && (
          <small>
            Cerrar el navegador no revierte una operación ya confirmada.
          </small>
        )}
      </div>
    </div>
  );
}

export function uploadWithProgress<T>(
  url: string,
  payload: FormData | string,
  options: {
    onProgress?: (value: TransferProgress) => void;
    onUploaded?: () => void;
    signal?: AbortSignal;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = () => options.signal?.removeEventListener("abort", abort);
    xhr.open("POST", url, true);
    xhr.withCredentials = true;
    xhr.timeout = 180000;
    if (typeof payload === "string")
      xhr.setRequestHeader("Content-Type", "application/json");
    for (const [key, value] of Object.entries(options.headers || {}))
      xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (event) =>
      options.onProgress?.({
        loaded: event.loaded,
        ...(event.lengthComputable && event.total > 0
          ? { total: event.total }
          : {}),
      });
    xhr.upload.onload = () => options.onUploaded?.();
    xhr.onload = () => {
      finish();
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(
          new Error(
            "El servidor no devolvió un resultado válido. Consulta el estado antes de repetir.",
          ),
        );
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300)
        reject(
          Object.assign(
            new Error(
              typeof data.error === "string"
                ? data.error
                : "No se pudo completar la operación.",
            ),
            { status: xhr.status, code: data.code },
          ),
        );
      else resolve(data as T);
    };
    xhr.onerror = () => {
      finish();
      reject(
        new Error(
          "Se perdió la conexión. Consulta el estado del intento antes de repetir.",
        ),
      );
    };
    xhr.ontimeout = () => {
      finish();
      reject(
        new Error(
          "La confirmación tardó demasiado. Consulta el estado del intento antes de repetir.",
        ),
      );
    };
    xhr.onabort = () => {
      finish();
      reject(
        new Error(
          "La espera se interrumpió; esto no revierte productos ya guardados.",
        ),
      );
    };
    if (options.signal?.aborted) {
      reject(new Error("La espera se interrumpió."));
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    xhr.send(payload);
  });
}

export function readFileWithProgress(
  file: File,
  onProgress: (value: TransferProgress) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) =>
      onProgress({
        loaded: e.loaded,
        ...(e.lengthComputable ? { total: e.total } : {}),
      });
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsText(file, "utf-8");
  });
}
