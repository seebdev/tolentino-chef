"use client";
import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import type { PublicMenuData } from "@/lib/types";
import { MenuRenderer } from "./public-menu";

// A static srcDoc uses standards mode and no app route. React portals render the SAME tree
// and copy the same stylesheet URLs; CSS media queries use this real viewport.
export function MenuPreview({
  data,
  width,
}: {
  data: PublicMenuData;
  width: number;
}) {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const attach = useCallback((frame: HTMLIFrameElement | null) => {
    if (!frame) return;
    const ready = () => {
      const doc = frame.contentDocument;
      if (!doc || doc.getElementById("menu-preview-root")) return;
      doc.documentElement.lang = "es";
      const meta = doc.createElement("meta");
      meta.name = "viewport";
      meta.content = "width=device-width, initial-scale=1";
      doc.head.append(meta);
      for (const original of document.querySelectorAll(
        'link[rel="stylesheet"],style',
      )) {
        const clone = original.cloneNode(true) as HTMLElement;
        if (clone instanceof HTMLLinkElement)
          clone.href = (original as HTMLLinkElement).href;
        doc.head.append(clone);
      }
      const root = doc.createElement("div");
      root.id = "menu-preview-root";
      doc.body.append(root);
      setMount(root);
    };
    frame.addEventListener("load", ready, { once: true });
    ready();
  }, []);
  return (
    <div className="menu-preview-scroll">
      <iframe
        ref={attach}
        srcDoc="<!doctype html><html><head></head><body></body></html>"
        title="Vista previa del menú"
        className="menu-preview-frame"
        style={{ width, height: 820 }}
      />
      {mount && createPortal(<MenuRenderer data={data} preview />, mount)}
    </div>
  );
}
