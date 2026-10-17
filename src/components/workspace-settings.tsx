"use client";
import { useState, useEffect, useRef, type FormEvent } from "react";
import {
  Eye,
  ExternalLink,
  Check as CheckIcon,
  Download,
  QrCode,
  Globe,
  Trash2,
  RefreshCw,
  FileSpreadsheet,
  ArrowRight,
  KeyRound,
  Shield,
  ImagePlus,
  Copy,
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
} from "./ui";
import {
  DEFAULT_APPEARANCE,
  mediaUrl,
  money,
  type WorkspaceData,
  type Appearance,
  type Hours,
} from "@/lib/types";
import { languages } from "@/lib/i18n";
import type { Mutate } from "./workspace";
import { DownloadLink } from "./download-link";
type Props = { data: WorkspaceData; mutate: Mutate; busy: boolean };
export function AppearancePanel({ data, mutate, busy }: Props) {
  const [appearance, setAppearance] = useState<Appearance>({
    ...DEFAULT_APPEARANCE,
    ...data.settings.appearance,
    ...data.settings.draft_appearance,
  });
  const [uploading, setUploading] = useState("");
  const operationInFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState(data.restaurant.name);
  const [description, setDescription] = useState(
    data.restaurant.description || "",
  );
  const update = (key: keyof Appearance, value: string) =>
    setAppearance((a) => ({ ...a, [key]: value }));
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
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await api<{ path: string }>(
        "/api/workspace/" + data.restaurant.id + "/media",
        { method: "POST", body },
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
    try {
      if (await mutate("save_appearance", { appearance, name, description })) {
        if (publishing) await mutate("publish_appearance", {});
      }
    } finally {
      operationInFlight.current = false;
      setSaving(false);
    }
  }
  return (
    <div className="settings-two-column">
      <form className="panel form-panel" onSubmit={save}>
        <div className="section-heading">
          <h2>Identidad de tu restaurante</h2>
          <p>
            Colores, tipografía e imágenes se guardan como borrador. El nombre y
            la descripción se actualizan al guardar.
          </p>
        </div>
        {error && <Notice message={error} error />}
        <div className="form-grid">
          <Field label="Nombre">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              aria-label="Nombre del restaurante"
            />
          </Field>
          <Field label="Tipografía">
            <select
              value={appearance.font}
              onChange={(e) => update("font", e.target.value)}
              aria-label="Tipografía"
            >
              <option value="sans">Moderna · Sans serif</option>
              <option value="serif">Clásica · Serif</option>
              <option value="rounded">Cercana · Rounded</option>
            </select>
          </Field>
        </div>
        <Field label="Descripción">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            aria-label="Descripción del restaurante"
          />
        </Field>
        <div className="form-grid">
          <Field label="Color principal">
            <div className="color-field">
              <input
                type="color"
                value={appearance.primary}
                onChange={(e) => update("primary", e.target.value)}
                aria-label="Color principal"
              />
              <span>{appearance.primary.toUpperCase()}</span>
            </div>
          </Field>
          <Field label="Color secundario">
            <div className="color-field">
              <input
                type="color"
                value={appearance.secondary}
                onChange={(e) => update("secondary", e.target.value)}
                aria-label="Color secundario"
              />
              <span>{appearance.secondary.toUpperCase()}</span>
            </div>
          </Field>
        </div>
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
                {uploading === item.key ? "Subiendo…" : "Subir imagen"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={!!uploading || busy || saving}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void upload(item.key, file);
                  }}
                />
              </label>
              {appearance[item.key] && (
                <button
                  className="text-button danger-text"
                  type="button"
                  onClick={() => update(item.key, "")}
                >
                  Quitar
                </button>
              )}
            </div>
          ))}
        </div>
        <small className="helper-text">
          JPG, PNG y WebP · hasta 5 MB por archivo.
        </small>
        <div className="form-footer">
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
      <aside>
        <div className="preview-label">
          <Eye size={16} />
          VISTA PREVIA DEL BORRADOR
        </div>
        <div
          className={"phone-preview font-" + appearance.font}
          style={
            {
              "--menu-primary": appearance.primary,
              "--menu-secondary": appearance.secondary,
            } as React.CSSProperties
          }
        >
          <div className="phone-top">
            <span /> <i />
          </div>
          <div
            className="phone-cover"
            style={{ backgroundColor: appearance.primary }}
          >
            {appearance.cover_path && (
              <img
                src={mediaUrl(data.restaurant.id, appearance.cover_path)}
                alt="Portada"
              />
            )}
          </div>
          <div className="phone-identity">
            {appearance.logo_path ? (
              <img
                src={mediaUrl(data.restaurant.id, appearance.logo_path)}
                alt="Logo"
              />
            ) : (
              <span style={{ background: appearance.primary }}>
                {name.slice(0, 1)}
              </span>
            )}
            <h3>{name}</h3>
            <p>
              {description ||
                "La descripción de tu restaurante aparecerá aquí."}
            </p>
          </div>
          <div className="phone-categories">
            <span style={{ background: appearance.primary, color: "#fff" }}>
              Todo el menú
            </span>
            {data.categories.slice(0, 2).map((c) => (
              <span key={c.id}>{c.name}</span>
            ))}
          </div>
          <div className="phone-products">
            {data.products.length ? (
              data.products.slice(0, 3).map((p) => (
                <div className="phone-product" key={p.id}>
                  <div>
                    <strong>{p.name}</strong>
                    <small>{p.description}</small>
                    <b style={{ color: appearance.primary }}>
                      {money(p.price, data.restaurant.currency)}
                    </b>
                  </div>
                  {p.image_path && (
                    <img
                      src={mediaUrl(data.restaurant.id, p.image_path)}
                      alt=""
                    />
                  )}
                </div>
              ))
            ) : (
              <p className="helper-text">
                Tus productos aparecerán aquí cuando los añadas.
              </p>
            )}
          </div>
          <div className="phone-footer">MENÚ DIGITAL · TOLENTINO</div>
        </div>
        <p className="preview-help">
          La vista previa muestra tu borrador visual. Publica para aplicar
          colores, tipografía e imágenes.
        </p>
      </aside>
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
  const [search, setSearch] = useState("");
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogError, setCatalogError] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      api<WorkspaceData>(
        "/api/workspace/" +
          data.restaurant.id +
          "?page=" +
          catalogPage +
          "&q=" +
          encodeURIComponent(search),
      )
        .then(setCatalog)
        .catch((e) => setCatalogError((e as Error).message));
    }, 250);
    return () => clearTimeout(timer);
  }, [data.restaurant.id, catalogPage, search]);
  const entities = [
    ...data.categories.map((c) => ({
      key: "category:" + c.id,
      name: c.name,
      description: "",
    })),
    ...catalog.products.map((p) => ({
      key: "product:" + p.id,
      name: p.name,
      description: p.description,
    })),
  ];
  function select(key: string, lang = language) {
    setEntity(key);
    const [type, id] = key.split(":");
    const t = data.translations.find(
      (x) =>
        x.entity_type === type && x.entity_id === id && x.language === lang,
    );
    setName(t?.fields.name || "");
    setDescription(t?.fields.description || "");
  }
  const selected = entities.find((e) => e.key === entity);
  return (
    <div className="settings-two-column language-layout">
      <section className="panel form-panel">
        <div className="section-heading">
          <h2>Idiomas de tu menú</h2>
          <p>
            La interfaz está disponible en siete idiomas. El contenido lo
            traduces tú.
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
            <Check
              key={l.code}
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
              fields: { name, description },
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
                    {e.key.startsWith("category") ? "Categoría" : "Producto"} ·{" "}
                    {e.name}
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
            <Field label="Nombre traducido">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                aria-label="Nombre traducido"
              />
            </Field>
            {entity.startsWith("product:") && (
              <Field label="Descripción traducida">
                <textarea
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  aria-label="Descripción traducida"
                />
              </Field>
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
export function QrPanel({
  data,
  mutate,
  busy,
  support,
}: Props & { support: boolean }) {
  const [config, setConfig] = useState(
    data.qr ?? {
      foreground: "#163c2c",
      background: "#ffffff",
      frame: "simple",
      label: "Descubre nuestro menú",
      include_logo: false,
    },
  );
  const [version, setVersion] = useState(0);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [previewError, setPreviewError] = useState(false);
  const url = "/api/workspace/" + data.restaurant.id + "/qr";
  const stable = "/q/" + data.restaurant.public_token;
  async function save() {
    if (await mutate("save_qr", config)) {
      setVersion((v) => v + 1);
      setPreviewError(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.origin + stable);
      setCopied(true);
    } catch {
      setError(
        "No se pudo copiar. Puedes abrir el enlace y copiarlo desde el navegador.",
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
        {error && <Notice message={error} error />}
        {support ? (
          <>
            <div className="form-grid">
              <Field label="Color del código">
                <input
                  type="color"
                  value={config.foreground}
                  aria-label="Color del código"
                  onChange={(e) =>
                    setConfig({ ...config, foreground: e.target.value })
                  }
                />
              </Field>
              <Field label="Color del fondo">
                <input
                  type="color"
                  value={config.background}
                  aria-label="Color del fondo"
                  onChange={(e) =>
                    setConfig({ ...config, background: e.target.value })
                  }
                />
              </Field>
            </div>
            <Field label="Marco">
              <select
                value={config.frame}
                aria-label="Marco"
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
                aria-label="Texto del QR"
                onChange={(e) =>
                  setConfig({ ...config, label: e.target.value })
                }
              />
            </Field>
            <Check
              label="Incluir el logo del restaurante"
              checked={config.include_logo}
              disabled={!data.settings.appearance?.logo_path}
              onChange={(e) =>
                setConfig({ ...config, include_logo: e.target.checked })
              }
            />
            <p className="helper-text">
              El servidor valida el contraste y limita el tamaño del logo para
              conservar la lectura.
            </p>
            <div className="form-footer">
              <Button busy={busy} onClick={save}>
                Guardar diseño
              </Button>
            </div>
          </>
        ) : (
          <div className="connection-notice">
            <QrCode size={21} />
            <p>
              Tu QR está listo para descargar. Tolentino puede ayudarte a
              personalizar sus colores, marco y logo.
            </p>
          </div>
        )}
        <div className="section-divider">ENLACE PERMANENTE</div>
        <div className="copy-link">
          <a href={stable} target="_blank" rel="noreferrer">
            Abrir enlace del QR <ExternalLink size={14} />
          </a>
          <button
            className="icon-button"
            onClick={copy}
            aria-label="Copiar enlace permanente"
          >
            {copied ? <CheckIcon size={18} /> : <Copy size={18} />}
          </button>
        </div>
        <small className="helper-text">
          Conserva este QR al cambiar el nombre, la dirección o el diseño de tu
          restaurante.
        </small>
      </section>
      <section className="panel qr-display">
        <span className="eyebrow">TU MENÚ A UN ESCANEO</span>
        <div className="qr-image">
          {previewError ? (
            <Notice
              error
              message="No se pudo generar la vista previa del QR. Revisa la configuración del servicio."
            />
          ) : (
            <img
              key={version}
              src={url + "?format=svg&v=" + version}
              alt="Código QR del restaurante"
              onError={() => setPreviewError(true)}
            />
          )}
        </div>
        <h3>{data.restaurant.name}</h3>
        <p>Descárgalo y compártelo en tus mesas.</p>
        <div className="qr-downloads">
          {["png", "svg", "pdf"].map((format) => (
            <DownloadLink
              className="button secondary small"
              key={format}
              href={url + "?format=" + format}
              filename={"qr-" + data.restaurant.slug + "." + format}
            >
              <Download size={15} />
              {format.toUpperCase()}
            </DownloadLink>
          ))}
        </div>
        <small>Haz una prueba de escaneo antes de imprimir.</small>
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
type ImportResult = {
  headers?: string[];
  rows?: Record<string, unknown>[];
  errors?: unknown[];
  duplicates?: unknown[];
  summary?: Record<string, number>;
  message?: string;
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
  const [mode, setMode] = useState("skip");
  const [createCategories, setCreateCategories] = useState(true);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const importInFlight = useRef(false);
  const endpoint = "/api/workspace/" + data.restaurant.id + "/import";
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
    try {
      const text = await file.text();
      setCsv(text);
      setFilename(file.name);
      const result = await post<ImportResult>(endpoint, {
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
    } catch (e) {
      setError((e as Error).message);
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
    try {
      const result = await post<ImportResult>(endpoint, {
        action,
        csv,
        mapping,
        mode,
        createCategories,
      });
      setPreview(result);
      if (action === "commit") {
        setMessage(
          result.message ||
            "Importación completada. Revisa el resultado antes de publicar tus productos.",
        );
        setCsv("");
        setHeaders([]);
        await onComplete();
      }
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
          <h3>Resultado de la validación</h3>
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
                Se guardarán los productos validados según las opciones
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
