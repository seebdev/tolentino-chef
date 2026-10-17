"use client";
import { useRef, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { Notice } from "./ui";

export function DownloadLink({
  href,
  filename,
  children,
  className = "text-button",
}: {
  href: string;
  filename: string;
  children: ReactNode;
  className?: string;
}) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(href, {
        credentials: "same-origin",
        cache: "no-store",
      }).catch(() => {
        throw new Error(
          "No se pudo descargar el archivo. Revisa tu conexión y vuelve a intentarlo.",
        );
      });
      if (
        !response.ok ||
        response.headers.get("content-type")?.includes("application/json")
      ) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.error ||
            "No se pudo descargar el archivo. Revisa tu sesión e inténtalo de nuevo.",
        );
      }
      const blob = await response.blob();
      if (!blob.size)
        throw new Error(
          "El servidor devolvió un archivo vacío. Intenta descargarlo de nuevo.",
        );
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <a
        href={href}
        download={filename}
        onClick={download}
        className={className}
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
      >
        {busy && <LoaderCircle size={15} className="spin" />}
        {children}
      </a>
      {error && <Notice error message={error} />}
    </>
  );
}
