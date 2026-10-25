"use client";
import { useState, useEffect, useRef, type FormEvent } from "react";
import {
  Eye,
  ExternalLink,
  Globe,
  Trash2,
  RefreshCw,
  ArrowRight,
  KeyRound,
  Shield,
  ImagePlus,
} from "lucide-react";
import {
  Button,
  Field,
  Notice,
  Check,
  Empty,
  api,
  post,
  Badge,
  Modal,
  Pagination,
  Loading,
} from "./ui";
import {
  mediaUrl,
  type WorkspaceData,
  type Appearance,
  type Hours,
  type PublicMenuData,
} from "@/lib/types";
import { menuAppearance, contrastWarnings } from "@/lib/menu-theme";
import { MenuPreview } from "./menu-preview";
import {
  ImportProgress,
  uploadWithProgress,
  type TransferProgress,
} from "./import-progress";
import { languages } from "@/lib/i18n";
import type { Mutate } from "./workspace";
import { TranslationStatus } from "./translation-status";
type Props = { data: WorkspaceData; mutate: Mutate; busy: boolean };
export function AppearancePanel({ data, mutate, busy }: Props) {
  const [appearance, setAppearance] = useState<Appearance>(() =>
    menuAppearance({
      ...data.settings.appearance,
      ...data.settings.draft_appearance,
    }),
  );
  const [name, setName] = useState(
    data.settings.draft_name ?? data.restaurant.name,
  );
  const [description, setDescription] = useState(
    data.settings.draft_description ?? data.restaurant.description ?? "",
  );
  const [revision, setRevision] = useState(
    data.settings.appearance_revision ?? 0,
  );
  const [uploading, setUploading] = useState("");
  const [uploadProgress, setUploadProgress] = useState<TransferProgress>({
    loaded: 0,
  });
  const [uploadStored, setUploadStored] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [previewData, setPreviewData] = useState<PublicMenuData | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [width, setWidth] = useState(390);
  const operationInFlight = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    api<PublicMenuData>("/api/workspace/" + data.restaurant.id + "/preview", {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setPreviewData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setPreviewError((e as Error).message);
      });
    return () => controller.abort();
  }, [data.restaurant.id]);
  function update<K extends keyof Appearance>(key: K, value: Appearance[K]) {
    setAppearance((a) => ({ ...a, [key]: value }));
    setSaved("");
  }
  async function upload(
    key: "logo_path" | "cover_path" | "favicon_path",
    file: File,
  ) {
    if (operationInFlight.current || busy) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("La imagen supera el límite de 5 MB.");
      return;
    }
    operationInFlight.current = true;
    setUploading(key);
    setUploadProgress({ loaded: 0 });
    setUploadStored(false);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await uploadWithProgress<{ path: string }>(
        "/api/workspace/" + data.restaurant.id + "/media",
        body,
        {
          onProgress: setUploadProgress,
          onUploaded: () => setUploadStored(true),
        },
      );
      update(key, result.path);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      operationInFlight.current = false;
      setUploading("");
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (operationInFlight.current || busy || !e.currentTarget.reportValidity())
      return;
    const publishing =
      (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ===
      "publish";
    operationInFlight.current = true;
    setSaving(true);
    setError("");
    setSaved("");
    try {
      const ok = await mutate(
        publishing ? "publish_appearance" : "save_appearance",
        { appearance, name, description, expectedRevision: revision },
      );
      if (ok) {
        setRevision((v) => v + 1);
        setSaved(
          publishing
            ? "Publicación confirmada. La nueva versión ya está disponible."
            : "Borrador guardado. El menú público conserva su versión publicada.",
        );
      } else
        setError(
          "No se confirmó el guardado. Conservamos tus cambios aquí. Si otro editor guardó antes, recarga el borrador y revisa sus cambios.",
        );
    } finally {
      operationInFlight.current = false;
      setSaving(false);
    }
  }
  async function reload() {
    if (
      operationInFlight.current ||
      busy ||
      !window.confirm(
        "¿Descartar los cambios locales y cargar el último borrador guardado?",
      )
    )
      return;
    operationInFlight.current = true;
    setSaving(true);
    setError("");
    setSaved("");
    try {
      const latest = await api<WorkspaceData>(
        "/api/workspace/" + data.restaurant.id,
      );
      setAppearance(
        menuAppearance({
          ...latest.settings.appearance,
          ...latest.settings.draft_appearance,
        }),
      );
      setName(latest.settings.draft_name ?? latest.restaurant.name);
      setDescription(
        latest.settings.draft_description ??
          latest.restaurant.description ??
          "",
      );
      setRevision(latest.settings.appearance_revision ?? 0);
      setPreviewData(
        await api<PublicMenuData>(
          "/api/workspace/" + data.restaurant.id + "/preview",
        ),
      );
      setPreviewError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      operationInFlight.current = false;
      setSaving(false);
    }
  }
  const current = menuAppearance(appearance),
    warnings = contrastWarnings(appearance);
  const colors = [
    {
      key: "primary",
      label: "Color principal",
      help: "Títulos, precios, enlaces y categoría seleccionada.",
    },
    {
      key: "secondary",
      label: "Color secundario",
      help: "Fondo de promociones y pie del menú.",
    },
    {
      key: "background",
      label: "Fondo del menú",
      help: "Fondo de página y navegación por categorías.",
    },
    {
      key: "card",
      label: "Superficie de las tarjetas",
      help: "Tarjetas, búsqueda y ventanas de detalle.",
    },
    {
      key: "text",
      label: "Texto principal",
      help: "Nombres de productos y contenido de detalle.",
    },
    {
      key: "muted",
      label: "Texto secundario",
      help: "Descripciones, etiquetas y textos auxiliares.",
    },
    {
      key: "cover_overlay",
      label: "Superposición de portada",
      help: "Velo en degradado sobre la fotografía; el texto de portada es blanco.",
    },
  ] as const;
  const preview = previewData
    ? {
        ...previewData,
        restaurant: { ...previewData.restaurant, name, description },
        settings: { ...previewData.settings, appearance },
      }
    : null;
  return (
    <div className="appearance-editor">
      <form className="panel form-panel" onSubmit={save}>
        {uploading && (
          <ImportProgress
            stage={uploadStored ? "validating" : "uploading"}
            label={
              uploadStored ? "Procesando y guardando imagen" : "Subiendo imagen"
            }
            loaded={uploadProgress.loaded}
            total={uploadProgress.total}
          />
        )}
        <div className="section-heading">
          <h2>Identidad de tu restaurante</h2>
          <p>
            Nombre, descripción, colores, distribución e imágenes son un
            borrador privado hasta publicar. Los productos, categorías,
            promociones e idiomas se guardan desde sus propias secciones y
            pueden publicarse de inmediato.
          </p>
        </div>
        {error && <Notice message={error} error />}
        {saved && <Notice message={saved} />}
        <fieldset
          disabled={busy || saving || !!uploading}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <div className="form-grid">
            <Field label="Nombre">
              <input
                aria-label="Nombre del restaurante"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSaved("");
                }}
                required
                maxLength={100}
              />
            </Field>
            <Field label="Tipografía">
              <select
                aria-label="Tipografía"
                value={appearance.font}
                onChange={(e) => update("font", e.target.value)}
              >
                <option value="sans">Moderna · Sans serif</option>
                <option value="serif">Clásica · Serif</option>
                <option value="rounded">Cercana · Rounded</option>
              </select>
            </Field>
          </div>
          <Field label="Descripción">
            <textarea
              aria-label="Descripción del restaurante"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setSaved("");
              }}
              rows={3}
            />
          </Field>
          <div className="section-divider">COLORES DEL MENÚ</div>
          <div className="appearance-color-grid">
            {colors.map((c) => (
              <Field key={c.key} label={c.label} hint={c.help}>
                <div className="color-field">
                  <input
                    type="color"
                    value={current[c.key]}
                    aria-label={c.label}
                    onChange={(e) => update(c.key, e.target.value)}
                  />
                  <span>{current[c.key].toUpperCase()}</span>
                </div>
              </Field>
            ))}
            <Field
              label="Intensidad de la superposición"
              hint="Aumenta la intensidad para que el texto blanco destaque sobre la portada."
            >
              <input
                aria-label="Intensidad de la superposición"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={current.cover_overlay_opacity}
                onChange={(e) =>
                  update("cover_overlay_opacity", Number(e.target.value))
                }
              />
              <output>
                {Math.round(current.cover_overlay_opacity * 100)}%
              </output>
            </Field>
          </div>
          {warnings.length > 0 && (
            <div className="notice" role="status">
              <strong>Revisa el contraste de estos colores</strong>
              <ul className="appearance-contrast-list">
                {warnings.map((w) => (
                  <li key={w.label}>
                    {w.label}: {w.ratio.toFixed(2)}:1; recomendado 4.5:1 para
                    texto normal.
                  </li>
                ))}
              </ul>
              <p>
                Los colores elegidos se conservan. Comprueba también el texto
                blanco sobre tu fotografía.
              </p>
            </div>
          )}
          <div className="section-divider">PRODUCTOS POR FILA</div>
          <div className="form-grid">
            <Field
              label="Productos por fila en móvil"
              hint="Pantallas menores de 700 px."
            >
              <select
                aria-label="Productos por fila en móvil"
                value={current.columns_mobile}
                onChange={(e) =>
                  update("columns_mobile", Number(e.target.value) as 1 | 2)
                }
              >
                <option value={1}>1 tarjeta</option>
                <option value={2}>2 tarjetas</option>
              </select>
            </Field>
            <Field
              label="Productos por fila en escritorio"
              hint="Desde 700 px; la tableta utiliza esta opción."
            >
              <select
                aria-label="Productos por fila en escritorio"
                value={current.columns_desktop}
                onChange={(e) =>
                  update("columns_desktop", Number(e.target.value) as 1 | 2)
                }
              >
                <option value={1}>1 tarjeta</option>
                <option value={2}>2 tarjetas</option>
              </select>
            </Field>
          </div>
          <p className="helper-text">
            El listado conserva todos los productos. Recomendados tiene su
            propia disposición y permanece visible al buscar o filtrar.
          </p>
          <div className="section-divider">IMÁGENES DE MARCA</div>
          <div className="brand-uploads">
            {(
              [
                { key: "logo_path", label: "Logo" },
                { key: "cover_path", label: "Portada" },
                { key: "favicon_path", label: "Favicon" },
              ] as const
            ).map((item) => (
              <div className="brand-upload" key={item.key}>
                <span>
                  {appearance[item.key] ? (
                    <img
                      src={mediaUrl(data.restaurant.id, appearance[item.key])}
                      alt={item.label}
                    />
                  ) : (
                    <ImagePlus size={24} />
                  )}
                </span>
                <strong>{item.label}</strong>
                <label className="text-button">
                  {uploading === item.key ? "Subiendo imagen…" : "Subir imagen"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    aria-label={"Subir " + item.label.toLowerCase()}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void upload(item.key, file);
                    }}
                  />
                </label>
                {appearance[item.key] && (
                  <button
                    type="button"
                    className="text-button danger-text"
                    onClick={() => update(item.key, "")}
                  >
                    Quitar {item.label.toLowerCase()}
                  </button>
                )}
              </div>
            ))}
          </div>
          <small className="helper-text">
            JPG, PNG y WebP · hasta 5 MB. Subir un archivo no lo publica;
            publica el borrador para aplicarlo.
          </small>
        </fieldset>
        <div className="form-footer">
          <Button
            type="button"
            variant="secondary"
            onClick={reload}
            disabled={busy || saving || !!uploading}
          >
            Recargar borrador
          </Button>
          <Button
            type="submit"
            variant="secondary"
            busy={busy || saving || !!uploading}
          >
            Guardar borrador
          </Button>
          <Button
            type="submit"
            value="publish"
            busy={busy || saving || !!uploading}
          >
            Publicar cambios <ArrowRight size={16} />
          </Button>
        </div>
      </form>
      <section className="panel appearance-preview-panel">
        <div className="appearance-preview-toolbar">
          <div>
            <div className="preview-label">
              <Eye size={16} />
              VISTA PREVIA COMPLETA DEL BORRADOR
            </div>
            <p className="helper-text">
              Mismo menú y estilos que la publicación. El ancho es real, sin
              reducir la página con una escala.
            </p>
          </div>
          <Field label="Ancho de vista previa">
            <select
              value={width}
              aria-label="Ancho de vista previa"
              onChange={(e) => setWidth(Number(e.target.value))}
            >
              <option value={320}>Móvil · 320 px</option>
              <option value={390}>Móvil · 390 px</option>
              <option value={768}>Tableta · 768 px</option>
              <option value={1440}>Escritorio · 1440 px</option>
            </select>
          </Field>
        </div>
        {previewError ? (
          <Notice message={previewError} error />
        ) : preview ? (
          <MenuPreview data={preview} width={width} />
        ) : (
          <Loading text="Cargando el menú completo para la vista previa…" />
        )}
      </section>
    </div>
  );
}
const days = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];
export function HoursPanel({ data, mutate, busy }: Props) {
  const [hours, setHours] = useState<Hours[]>(
    days.map(
      (_, day) =>
        data.hours.find((h) => h.day_of_week === day) || {
          day_of_week: day,
          opens_at: "09:00",
          closes_at: "18:00",
          is_closed: true,
        },
    ),
  );
  const update = (day: number, key: keyof Hours, value: string | boolean) =>
    setHours((h) =>
      h.map((row) =>
        row.day_of_week === day ? { ...row, [key]: value } : row,
      ),
    );
  return (
    <section className="panel form-panel">
      <div className="section-heading">
        <h2>Horarios de atención</h2>
        <p>Los días marcados como cerrados se mostrarán así en el menú.</p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutate("save_hours", { hours });
        }}
      >
        <div className="hours-list">
          {[1, 2, 3, 4, 5, 6, 0].map((day) => {
            const h = hours[day];
            return (
              <div className="hours-row" key={day}>
                <strong>{days[day]}</strong>
                <Check
                  label="Cerrado"
                  checked={h.is_closed}
                  onChange={(e) => update(day, "is_closed", e.target.checked)}
                />
                <input
                  type="time"
                  aria-label={"Apertura " + days[day]}
                  value={h.opens_at?.slice(0, 5) || "09:00"}
                  disabled={h.is_closed}
                  onChange={(e) => update(day, "opens_at", e.target.value)}
                />
                <span>a</span>
                <input
                  type="time"
                  aria-label={"Cierre " + days[day]}
                  value={h.closes_at?.slice(0, 5) || "18:00"}
                  disabled={h.is_closed}
                  onChange={(e) => update(day, "closes_at", e.target.value)}
                />
              </div>
            );
          })}
        </div>
        <div className="form-footer">
          <Button type="submit" busy={busy}>
            Guardar horarios
          </Button>
        </div>
      </form>
    </section>
  );
}
export function LanguagesPanel({ data, mutate, busy }: Props) {
  const [main, setMain] = useState(data.restaurant.default_language || "es");
  const [enabled, setEnabled] = useState(
    data.settings.enabled_languages || ["es"],
  );
  const [language, setLanguage] = useState(
    (data.settings.enabled_languages || []).find((x) => x !== main) || "en",
  );
  const [entity, setEntity] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [catalog, setCatalog] = useState(data);
  const [ingredients, setIngredients] = useState("");
  const [tagNames, setTagNames] = useState<string[]>([]);
  const [extraNames, setExtraNames] = useState<string[]>([]);
  const [variantNames, setVariantNames] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogError, setCatalogError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<WorkspaceData>(
        "/api/workspace/" +
          data.restaurant.id +
          "?page=" +
          catalogPage +
          "&q=" +
          encodeURIComponent(search),
        { signal: controller.signal },
      )
        .then((result) => {
          if (!controller.signal.aborted) {
            setCatalog(result);
            setCatalogError("");
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) setCatalogError((e as Error).message);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [data.restaurant.id, catalogPage, search]);
  const entities: {
    key: string;
    name: string;
    description: string;
    ingredients?: string;
    tags?: string[];
    extras?: { name: string }[];
    variants?: { name: string }[];
  }[] = [
    {
      key: "restaurant:" + data.restaurant.id,
      name: data.restaurant.name,
      description: data.restaurant.description || "",
    },
    ...data.promotions.map((p) => ({
      key: "promotion:" + p.id,
      name: p.title,
      description: p.description,
    })),
    ...data.categories.map((c) => ({
      key: "category:" + c.id,
      name: c.name,
      description: "",
    })),
    ...catalog.products.map((p) => ({
      key: "product:" + p.id,
      name: p.name,
      description: p.description,
      ingredients: p.ingredients,
      tags: p.tags,
      extras: p.extras,
      variants: p.variants,
    })),
  ];
  function select(key: string, lang = language) {
    setEntity(key);
    const [type, id] = key.split(":");
    const t = data.translations.find(
      (x) =>
        x.entity_type === type && x.entity_id === id && x.language === lang,
    );
    setName(t?.fields.title || t?.fields.name || "");
    setDescription(t?.fields.description || "");
    const source = entities.find((x) => x.key === key);
    setIngredients(t?.fields.ingredients || "");
    setTagNames((source?.tags || []).map((_, i) => t?.fields.tags?.[i] || ""));
    setExtraNames(
      (source?.extras || []).map((_, i) => t?.fields.extras?.[i]?.name || ""),
    );
    setVariantNames(
      (source?.variants || []).map(
        (_, i) => t?.fields.variants?.[i]?.name || "",
      ),
    );
  }
  const selected = entities.find((e) => e.key === entity);
  return (
    <div className="settings-two-column language-layout">
      <div className="translation-status-row">
        <TranslationStatus restaurantId={data.restaurant.id} />
      </div>
      <section className="panel form-panel">
        <div className="section-heading">
          <h2>Idiomas de tu menú</h2>
          <p>
            La interfaz está disponible en siete idiomas. Revisa las
            traducciones del contenido y completa o corrige los campos
            manualmente. Los campos vacíos no borran traducciones guardadas.
            Para traducir etiquetas, extras o presentaciones, completa todos
            los nombres de esa lista; si la dejas vacía, queda pendiente de
            traducción automática.
          </p>
        </div>
        <Field label="Idioma principal">
          <select
            value={main}
            aria-label="Idioma principal"
            onChange={(e) => {
              setMain(e.target.value);
              setEnabled((v) => Array.from(new Set([...v, e.target.value])));
              if (language === e.target.value) {
                const next = languages.find(
                  (l) => l.code !== e.target.value,
                )!.code;
                setLanguage(next);
                select(entity, next);
              }
            }}
          >
            {languages.map((l) => (
              <option value={l.code} key={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="language-checks">
          {languages.map((l) => (
            <div className="language-option-with-flag" key={l.code}>
              <img src={l.flag} alt="" width={25} height={19} />
              <Check
                label={l.label + (l.code === main ? " · principal" : "")}
                checked={enabled.includes(l.code)}
                disabled={l.code === main}
                onChange={(e) =>
                  setEnabled((v) =>
                    e.target.checked
                      ? [...v, l.code]
                      : v.filter((x) => x !== l.code),
                  )
                }
              />
            </div>
          ))}
        </div>
        <div className="form-footer">
          <Button
            busy={busy}
            onClick={() =>
              mutate("save_languages", {
                default_language: main,
                enabled_languages: enabled,
              })
            }
          >
            Guardar idiomas
          </Button>
        </div>
      </section>
      <section className="panel form-panel">
        <div className="section-heading">
          <h2>Traducciones del contenido</h2>
          <p>
            Si un campo está vacío, se muestra el texto del idioma principal.
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const [type, id] = entity.split(":");
            mutate("save_translation", {
              entity_type: type,
              entity_id: id,
              language,
              fields:
                type === "restaurant"
                  ? { description }
                  : type === "promotion"
                    ? { title: name, description }
                    : type === "category"
                      ? { name }
                      : {
                          name,
                          description,
                          ingredients,
                          tags: tagNames,
                          extras: extraNames.map((name) => ({ name })),
                          variants: variantNames.map((name) => ({ name })),
                        },
            });
          }}
        >
          <div className="form-stack">
            <Field label="Idioma de la traducción">
              <select
                aria-label="Idioma de la traducción"
                value={language}
                onChange={(e) => {
                  setLanguage(e.target.value);
                  select(entity, e.target.value);
                }}
              >
                {languages
                  .filter((l) => l.code !== main)
                  .map((l) => (
                    <option value={l.code} key={l.code}>
                      {l.label}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Buscar producto para traducir">
              <input
                value={search}
                aria-label="Buscar producto para traducir"
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCatalogPage(1);
                }}
              />
            </Field>
            {catalogError && <Notice message={catalogError} error />}
            <Field label="Categoría o producto">
              <select
                value={entity}
                onChange={(e) => select(e.target.value)}
                required
                aria-label="Categoría o producto"
              >
                <option value="">Seleccionar contenido</option>
                {entities.map((e) => (
                  <option key={e.key} value={e.key}>
                    {e.key.startsWith("category")
                      ? "Categoría"
                      : e.key.startsWith("promotion")
                        ? "Promoción"
                        : e.key.startsWith("restaurant")
                          ? "Restaurante"
                          : "Producto"}{" "}
                    · {e.name}
                  </option>
                ))}
              </select>
            </Field>
            {selected && (
              <div className="translation-source">
                <small>TEXTO ORIGINAL</small>
                <strong>{selected.name}</strong>
                <p>{selected.description}</p>
              </div>
            )}
            {!entity.startsWith("restaurant:") && (
              <Field label="Nombre traducido">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={200}
                  aria-label="Nombre traducido"
                />
              </Field>
            )}
            {entity && !entity.startsWith("category:") && (
              <Field label="Descripción traducida">
                <textarea
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  aria-label="Descripción traducida"
                />
              </Field>
            )}
            {entity.startsWith("product:") && (
              <>
                <Field label="Ingredientes traducidos">
                  <textarea
                    aria-label="Ingredientes traducidos"
                    value={ingredients}
                    onChange={(e) => setIngredients(e.target.value)}
                    placeholder={selected?.ingredients || ""}
                  />
                </Field>
                {(
                  [
                    {
                      label: "Etiqueta",
                      values: tagNames,
                      set: setTagNames,
                      source: selected?.tags || [],
                    },
                    {
                      label: "Extra",
                      values: extraNames,
                      set: setExtraNames,
                      source: selected?.extras?.map((x) => x.name) || [],
                    },
                    {
                      label: "Presentación existente",
                      values: variantNames,
                      set: setVariantNames,
                      source: selected?.variants?.map((x) => x.name) || [],
                    },
                  ] as const
                ).map((group) =>
                  group.values.map((value, index) => (
                    <Field
                      key={group.label + index}
                      label={group.label + " · " + group.source[index]}
                    >
                      <input
                        aria-label={group.label + " traducido " + (index + 1)}
                        value={value}
                        onChange={(e) =>
                          group.set((values) =>
                            values.map((text, i) =>
                              i === index ? e.target.value : text,
                            ),
                          )
                        }
                      />
                    </Field>
                  )),
                )}
                <p className="helper-text">
                  Sólo se traducen los nombres; se conservan orden, cantidades y
                  precios originales. Los campos vacíos muestran el texto
                  fuente.
                </p>
              </>
            )}
            <div className="form-footer">
              <Button type="submit" disabled={!entity} busy={busy}>
                Guardar traducción
              </Button>
            </div>
          </div>
        </form>
        <Pagination
          pageSize={25}
          page={catalogPage}
          total={catalog.total}
          onChange={setCatalogPage}
        />
      </section>
    </div>
  );
}
export function DomainsPanel({ data, mutate, busy }: Props) {
  const [hostname, setHostname] = useState("");
  const [remove, setRemove] = useState<string | null>(null);
  const [register, setRegister] = useState<string | null>(null);
  return (
    <section className="panel form-panel">
      <div className="section-heading">
        <h2>Direcciones del restaurante</h2>
        <p>
          El enlace estándar permanece disponible, incluso si falla un dominio
          personalizado.
        </p>
      </div>
      <div className="standard-domain">
        <Globe size={22} />
        <div>
          <small>ENLACE ESTÁNDAR</small>
          <a
            href={"/menu/" + data.restaurant.slug}
            target="_blank"
            rel="noreferrer"
          >
            /menu/{data.restaurant.slug}
            <ExternalLink size={14} />
          </a>
        </div>
        <Badge>Disponible</Badge>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await mutate("save_domain", { hostname })) setHostname("");
        }}
        className="inline-form"
      >
        <Field
          label="Nuevo dominio"
          hint="Solo el nombre, sin https:// ni rutas."
        >
          <input
            required
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="menu.turestaurante.com"
            aria-label="Nuevo dominio"
            pattern="[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"
          />
        </Field>
        <Button type="submit" busy={busy}>
          Registrar dominio
        </Button>
      </form>
      {data.domains.length ? (
        data.domains.map((d) => (
          <div className="domain-card" key={d.id}>
            <div className="domain-heading">
              <strong>{d.hostname}</strong>
              <Badge tone={d.status === "active" ? "green" : "amber"}>
                {d.status === "active"
                  ? "Activo"
                  : d.status === "verified"
                    ? "Verificado"
                    : "Pendiente"}
              </Badge>
            </div>
            {d.dns_instructions?.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Nombre</th>
                      <th>Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.dns_instructions.map((record, i) => (
                      <tr key={i}>
                        <td>{record.type}</td>
                        <td>
                          <code>{record.name}</code>
                        </td>
                        <td>
                          <code>{record.value}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>
                {d.instructions ||
                  "Consulta la documentación de despliegue para obtener los valores DNS reales de este servicio. La activación requiere verificar propiedad y conexión."}
              </p>
            )}
            {d.last_error && <Notice message={d.last_error} error />}
            <div className="form-footer wrap">
              {d.status !== "verified" && d.status !== "active" && (
                <Button
                  variant="secondary small"
                  busy={busy}
                  onClick={() => setRegister(d.id)}
                >
                  <Globe size={14} />
                  Registrar en Render
                </Button>
              )}
              <Button
                variant="secondary small"
                busy={busy}
                onClick={() => mutate("verify_domain", { id: d.id })}
              >
                <RefreshCw size={14} />
                Verificar conexión
              </Button>
              <button
                className="icon-button danger-text"
                aria-label={"Eliminar " + d.hostname}
                onClick={() => setRemove(d.id)}
              >
                <Trash2 size={17} />
              </button>
            </div>
          </div>
        ))
      ) : (
        <Empty
          icon={Globe}
          title="Tu dominio, cuando estás listo"
          description="Registra un dominio propio para mostrar las instrucciones de conexión."
        />
      )}
      {register && (
        <Modal
          title="Registrar dominio en Render"
          onClose={() => setRegister(null)}
        >
          <p>
            Se comprobará la propiedad del dominio y se registrará en el
            servicio de Render configurado para Tolentino. La activación se
            completa con la verificación de conexión.
          </p>
          <p className="helper-text">
            Render puede aplicar cargos según el plan del servicio.
          </p>
          <div className="form-footer">
            <Button variant="secondary" onClick={() => setRegister(null)}>
              Cancelar
            </Button>
            <Button
              busy={busy}
              onClick={async () => {
                if (await mutate("register_domain", { id: register }))
                  setRegister(null);
              }}
            >
              Registrar dominio
            </Button>
          </div>
        </Modal>
      )}
      {remove && (
        <Modal title="Quitar dominio" onClose={() => setRemove(null)}>
          <p>
            El dominio dejará de estar asociado a este restaurante. El menú
            seguirá disponible desde su dirección estándar.
          </p>
          <div className="form-footer">
            <Button variant="secondary" onClick={() => setRemove(null)}>
              Cancelar
            </Button>
            <Button
              busy={busy}
              variant="danger"
              onClick={async () => {
                if (await mutate("delete_domain", { id: remove }))
                  setRemove(null);
              }}
            >
              Quitar dominio
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
export function AccountPanel({
  data,
  support,
  busy,
  adminAction,
}: {
  data: WorkspaceData;
  support: boolean;
  busy: boolean;
  adminAction: (
    action: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const passwordInFlight = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<
    "owner_status" | "reset_access" | null
  >(null);
  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (passwordInFlight.current) return;
    setError("");
    setMessage("");
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    passwordInFlight.current = true;
    setPending(true);
    try {
      await post("/api/auth", { action: "password", password });
      setPassword("");
      setConfirm("");
      setMessage("Contraseña actualizada correctamente.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      passwordInFlight.current = false;
      setPending(false);
    }
  }
  return (
    <div className="settings-two-column">
      <section className="panel form-panel">
        <div className="section-heading">
          <h2>Datos del restaurante</h2>
          <p>La información de tu espacio y su propietario.</p>
        </div>
        <dl className="details-list">
          {[
            ["Restaurante", data.restaurant.name],
            ["Propietario", data.restaurant.owner_name],
            ["Correo", data.restaurant.owner_email],
            ["Teléfono", data.restaurant.phone || "Sin registrar"],
            ["Moneda", data.restaurant.currency],
            [
              "Estado",
              data.restaurant.status === "active" ? "Activo" : "Suspendido",
            ],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {support && (
          <>
            <div className="section-divider">ACCESO DEL PROPIETARIO</div>
            <Badge tone={data.membership?.is_active ? "green" : "amber"}>
              {data.membership?.is_active
                ? "Acceso activo"
                : "Acceso suspendido o pendiente"}
            </Badge>
            <div className="form-footer wrap">
              <Button
                variant="secondary"
                onClick={() => setConfirmation("reset_access")}
              >
                <KeyRound size={16} />
                Restablecer acceso
              </Button>
              <Button
                variant="secondary"
                onClick={() => setConfirmation("owner_status")}
              >
                <Shield size={16} />
                {data.membership?.is_active
                  ? "Suspender acceso"
                  : "Activar acceso"}
              </Button>
            </div>
          </>
        )}
      </section>
      {support ? (
        <form
          className="panel form-panel"
          onSubmit={(e) => {
            e.preventDefault();
            const f = Object.fromEntries(new FormData(e.currentTarget));
            adminAction("update", {
              ...data.restaurant,
              ...f,
              sale_amount: Number(f.sale_amount),
            });
          }}
        >
          <div className="section-heading">
            <h2>Registro comercial</h2>
            <p>Pago único, sin suscripciones ni vencimientos automáticos.</p>
          </div>
          <Field label="Fecha de venta">
            <input
              type="date"
              name="sale_date"
              defaultValue={
                data.sale?.sale_date || data.sale?.sold_at?.slice(0, 10) || ""
              }
              aria-label="Fecha de venta"
            />
          </Field>
          <div className="form-grid">
            <Field label="Importe cobrado">
              <input
                type="number"
                step=".01"
                min={0}
                name="sale_amount"
                defaultValue={data.sale?.amount ?? ""}
                aria-label="Importe cobrado"
              />
            </Field>
            <Field label="Moneda de venta">
              <select
                name="sale_currency"
                defaultValue={data.sale?.currency || data.restaurant.currency}
                aria-label="Moneda de venta"
              >
                {["COP", "USD", "EUR", "MXN", "PEN", "CLP", "ARS", "BRL"].map(
                  (c) => (
                    <option key={c}>{c}</option>
                  ),
                )}
              </select>
            </Field>
          </div>
          <Field label="Observaciones internas">
            <textarea
              rows={5}
              name="sale_notes"
              defaultValue={data.sale?.notes || ""}
              aria-label="Observaciones internas"
            />
          </Field>
          <div className="form-footer">
            <Button type="submit" busy={busy}>
              Guardar información
            </Button>
          </div>
        </form>
      ) : (
        <form className="panel form-panel" onSubmit={changePassword}>
          <div className="section-heading">
            <h2>Cambiar contraseña</h2>
            <p>Elige una contraseña única de al menos 12 caracteres.</p>
          </div>
          {error && <Notice error message={error} />}{" "}
          {message && <Notice message={message} />}
          <Field label="Nueva contraseña">
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={12}
              required
              aria-label="Nueva contraseña"
            />
          </Field>
          <Field label="Confirma tu contraseña">
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={12}
              required
              aria-label="Confirma tu contraseña"
            />
          </Field>
          <div className="form-footer">
            <Button type="submit" busy={pending}>
              Actualizar contraseña
            </Button>
          </div>
        </form>
      )}
      {confirmation && (
        <Modal
          title={
            confirmation === "reset_access"
              ? "Restablecer acceso"
              : "Cambiar estado de acceso"
          }
          onClose={() => setConfirmation(null)}
        >
          <p>
            {confirmation === "reset_access"
              ? "Se enviará un enlace seguro al correo del propietario para recuperar su acceso."
              : data.membership?.is_active
                ? "El propietario no podrá entrar a su administración. El menú público conserva su estado actual."
                : "El propietario podrá volver a administrar su restaurante."}
          </p>
          <div className="form-footer">
            <Button variant="secondary" onClick={() => setConfirmation(null)}>
              Cancelar
            </Button>
            <Button
              busy={busy}
              onClick={async () => {
                await adminAction(confirmation, {
                  is_active: !data.membership?.is_active,
                });
                setConfirmation(null);
              }}
            >
              Confirmar
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
