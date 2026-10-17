"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  LayoutDashboard,
  UtensilsCrossed,
  Layers,
  Megaphone,
  Palette,
  Clock3,
  Languages,
  FileUp,
  QrCode,
  UserRound,
  Globe,
  ExternalLink,
  Plus,
  Search,
  Pencil,
  Trash2,
  Copy,
  ArrowRight,
  Eye,
  Check,
  ImagePlus,
} from "lucide-react";
import {
  api,
  post,
  Shell,
  PageHeading,
  Button,
  Field,
  Notice,
  Empty,
  Loading,
  Badge,
  Modal,
  Check as Checkbox,
  Pagination,
  Stat,
} from "./ui";
import {
  mediaUrl,
  money,
  type WorkspaceData,
  type Session,
  type Product,
  type Category,
  type Promotion,
} from "@/lib/types";
import {
  AppearancePanel,
  HoursPanel,
  LanguagesPanel,
  QrPanel,
  DomainsPanel,
  ImportPanel,
  AccountPanel,
} from "./workspace-settings";
const navigation = [
  {
    id: "overview",
    label: "Resumen",
    icon: LayoutDashboard,
    group: "MI RESTAURANTE",
  },
  {
    id: "products",
    label: "Productos",
    icon: UtensilsCrossed,
    group: "MI RESTAURANTE",
  },
  {
    id: "categories",
    label: "Categorías",
    icon: Layers,
    group: "MI RESTAURANTE",
  },
  {
    id: "promotions",
    label: "Promociones",
    icon: Megaphone,
    group: "MI RESTAURANTE",
  },
  {
    id: "appearance",
    label: "Apariencia",
    icon: Palette,
    group: "PERSONALIZACIÓN",
  },
  { id: "hours", label: "Horarios", icon: Clock3, group: "PERSONALIZACIÓN" },
  {
    id: "languages",
    label: "Idiomas",
    icon: Languages,
    group: "PERSONALIZACIÓN",
  },
  { id: "qr", label: "Mi código QR", icon: QrCode, group: "HERRAMIENTAS" },
  {
    id: "import",
    label: "Importar productos",
    icon: FileUp,
    group: "HERRAMIENTAS",
  },
  { id: "domains", label: "Dominios", icon: Globe, group: "HERRAMIENTAS" },
  {
    id: "account",
    label: "Cuenta y acceso",
    icon: UserRound,
    group: "HERRAMIENTAS",
  },
];
const headings: Record<string, [string, string]> = {
  overview: [
    "Tu menú, en buenas manos.",
    "Todo lo que necesitas para cuidar tu experiencia digital.",
  ],
  products: [
    "Cada plato cuenta.",
    "Crea, organiza y actualiza los productos de tu menú.",
  ],
  categories: [
    "Un menú bien organizado.",
    "Agrupa tus productos en categorías y subcategorías.",
  ],
  promotions: [
    "Una razón para volver.",
    "Comparte novedades y promociones con tus visitantes.",
  ],
  appearance: [
    "Tan único como tu restaurante.",
    "Dale a tu menú los colores y la personalidad de tu marca.",
  ],
  hours: [
    "Siempre a tiempo.",
    "Mantén a tus visitantes al día con tus horarios.",
  ],
  languages: [
    "Un menú sin fronteras.",
    "Elige los idiomas y completa tus propias traducciones.",
  ],
  qr: [
    "Una puerta a tu menú.",
    "Tu código permanente sigue funcionando aunque cambies tu menú.",
  ],
  import: [
    "Tu carta, lista en minutos.",
    "Importa hasta 1.000 productos desde un archivo CSV.",
  ],
  domains: [
    "Tu propia dirección.",
    "Conecta una dirección personalizada y conserva tu enlace estándar.",
  ],
  account: [
    "Tu espacio, protegido.",
    "Consulta la información de tu restaurante y administra tu acceso.",
  ],
};
export type Mutate = (
  action: string,
  data: Record<string, unknown>,
) => Promise<boolean>;
export function Workspace({
  restaurantId,
  support = false,
}: {
  restaurantId?: string;
  support?: boolean;
}) {
  const [id, setId] = useState(restaurantId || "");
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [active, setActive] = useState("overview");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<{
    type: "product" | "category" | "promotion";
    value?: Product | Category | Promotion;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    action: string;
    id: string;
    name: string;
  } | null>(null);
  useEffect(() => {
    api<Session>("/api/session")
      .then((s) => {
        if (support && s.role !== "superadmin") {
          window.location.replace("/dashboard");
          return;
        }
        if (!restaurantId) {
          if (s.role === "superadmin") {
            window.location.replace("/admin");
            return;
          }
          if (s.restaurantId) setId(s.restaurantId);
          else {
            setError(
              "Tu cuenta no tiene un restaurante asignado. Contacta con Tolentino.",
            );
            setLoading(false);
          }
        }
      })
      .catch((e) => {
        if ((e as Error & { status?: number }).status === 401) {
          window.location.replace("/login");
          return;
        }
        setError((e as Error).message);
        setLoading(false);
      });
  }, [restaurantId, support]);
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const d = await api<WorkspaceData>(
        "/api/workspace/" +
          id +
          "?q=" +
          encodeURIComponent(q) +
          "&category=" +
          encodeURIComponent(category) +
          "&page=" +
          page,
      );
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id, q, category, page]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);
  const mutate: Mutate = async (action, payload) => {
    setBusy(true);
    setError("");
    try {
      const result = await post<{ message?: string }>("/api/workspace/" + id, {
        action,
        data: payload,
      });
      setMessage(result.message || "Cambios guardados correctamente.");
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  async function saveEditor(payload: Record<string, unknown>) {
    if (!editor) return;
    if (await mutate("save_" + editor.type, payload)) setEditor(null);
  }
  async function adminAction(action: string, payload: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await post<{ message?: string }>("/api/admin/restaurants", {
        action,
        restaurantId: id,
        data: payload,
      });
      setMessage(res.message || "Acceso actualizado.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const r = data?.restaurant;
  const nav = support
    ? navigation
    : navigation.filter((n) => n.id !== "domains");
  const [title, description] = headings[active] || headings.overview;
  return (
    <Shell
      items={nav}
      active={active}
      onNavigate={setActive}
      name={r?.name || "Mi restaurante"}
      subtitle={support ? "Modo soporte" : "Espacio del restaurante"}
      support={support}
      headerAction={
        r && (
          <a
            href={"/menu/" + r.slug}
            target="_blank"
            rel="noreferrer"
            className="button secondary small"
          >
            <Eye size={16} />
            Ver menú <ExternalLink size={13} />
          </a>
        )
      }
    >
      <PageHeading
        eyebrow={r?.name.toUpperCase() || "MI RESTAURANTE"}
        title={title}
        description={description}
        action={
          ["products", "categories", "promotions"].includes(active) && (
            <Button
              onClick={() =>
                setEditor({
                  type:
                    active === "products"
                      ? "product"
                      : active === "categories"
                        ? "category"
                        : "promotion",
                })
              }
            >
              <Plus size={17} />
              {active === "products"
                ? "Nuevo producto"
                : active === "categories"
                  ? "Nueva categoría"
                  : "Nueva promoción"}
            </Button>
          )
        }
      />
      {error && <Notice message={error} error onClose={() => setError("")} />}{" "}
      {message && <Notice message={message} onClose={() => setMessage("")} />}{" "}
      {!data ? (
        loading ? (
          <Loading />
        ) : (
          <Empty
            title="No pudimos abrir tu espacio"
            description="Comprueba tu sesión y vuelve a intentarlo."
            action={
              <a href="/login" className="button">
                Ir al acceso
              </a>
            }
          />
        )
      ) : (
        <>
          {active === "overview" && (
            <>
              <div className="stats-grid">
                <Stat
                  label="Productos en el menú"
                  value={data.stats.products ?? data.total}
                  detail="El sabor de tu restaurante"
                  icon={UtensilsCrossed}
                />
                <Stat
                  label="Productos publicados"
                  value={
                    data.stats.published ?? data.stats.published_products ?? "—"
                  }
                  detail="Visibles para tus visitantes"
                  icon={Eye}
                />
                <Stat
                  label="Categorías"
                  value={data.categories.length}
                  detail="Una carta fácil de explorar"
                  icon={Layers}
                />
                <Stat
                  label="Visitas al menú"
                  value={data.stats.visits ?? "—"}
                  detail="Visitas registradas"
                  icon={Globe}
                />
              </div>
              <div className="overview-grid">
                <section className="panel menu-status">
                  <div className="panel-heading">
                    <div>
                      <h2>Tu experiencia digital</h2>
                      <p>Lista para compartir, siempre actualizada.</p>
                    </div>
                    <Badge tone={r?.status === "active" ? "green" : "amber"}>
                      {r?.status === "active" ? "Activo" : "Suspendido"}
                    </Badge>
                  </div>
                  <div className="menu-preview-identity">
                    <span
                      style={{
                        background:
                          data.settings.appearance?.primary || "#264b3c",
                      }}
                    >
                      {data.settings.appearance?.logo_path ? (
                        <img
                          src={mediaUrl(id, data.settings.appearance.logo_path)}
                          alt="Logo"
                        />
                      ) : (
                        <UtensilsCrossed size={34} />
                      )}
                    </span>
                    <div>
                      <h3>{r?.name}</h3>
                      <p>
                        {r?.description ||
                          "Dale personalidad a tu menú desde Apariencia."}
                      </p>
                      <a
                        href={"/menu/" + r?.slug}
                        target="_blank"
                        rel="noreferrer"
                      >
                        /menu/{r?.slug}
                        <ExternalLink size={14} />
                      </a>
                    </div>
                  </div>
                  <div className="menu-status-footer">
                    <button
                      className="text-button"
                      onClick={() => setActive("appearance")}
                    >
                      Personalizar menú <ArrowRight size={16} />
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setActive("qr")}
                    >
                      Mi código QR <QrCode size={17} />
                    </button>
                  </div>
                </section>
                <section className="panel quick-actions">
                  <div className="panel-heading">
                    <div>
                      <h2>Un buen comienzo</h2>
                      <p>Tu menú, paso a paso.</p>
                    </div>
                  </div>
                  {[
                    {
                      id: "categories",
                      title: "Organiza tu carta",
                      text: "Crea las categorías de tu menú.",
                      done: data.categories.length > 0,
                      icon: Layers,
                    },
                    {
                      id: "products",
                      title: "Añade tus productos",
                      text: "Fotografías, ingredientes y precios.",
                      done: data.total > 0,
                      icon: UtensilsCrossed,
                    },
                    {
                      id: "appearance",
                      title: "Dale tu identidad",
                      text: "Colores, portada y logo.",
                      done: !!data.settings.appearance?.logo_path,
                      icon: Palette,
                    },
                    {
                      id: "qr",
                      title: "Comparte tu menú",
                      text: "Descarga tu QR permanente.",
                      done: false,
                      icon: QrCode,
                    },
                  ].map((item) => (
                    <button
                      key={item.id}
                      className="checklist-row"
                      onClick={() => setActive(item.id)}
                    >
                      <span
                        className={
                          item.done ? "step-icon complete" : "step-icon"
                        }
                      >
                        {item.done ? (
                          <Check size={17} />
                        ) : (
                          <item.icon size={17} />
                        )}
                      </span>
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.text}</small>
                      </span>
                      <ArrowRight size={16} />
                    </button>
                  ))}
                </section>
              </div>
            </>
          )}
          {active === "products" && (
            <section className="panel">
              <div className="filter-bar">
                <div className="search-input">
                  <Search size={18} />
                  <input
                    aria-label="Buscar productos"
                    placeholder="Buscar por nombre, descripción o código…"
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                      setPage(1);
                    }}
                  />
                </div>
                <select
                  aria-label="Filtrar categoría"
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Todas las categorías</option>
                  {data.categories.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              {loading ? (
                <Loading />
              ) : !data.products.length ? (
                <Empty
                  title={
                    q || category
                      ? "No encontramos productos"
                      : "El primer plato está por llegar"
                  }
                  description="Añade un producto o importa tu carta desde un archivo CSV."
                  action={
                    <Button onClick={() => setEditor({ type: "product" })}>
                      <Plus size={16} />
                      Añadir producto
                    </Button>
                  }
                />
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th>Categoría</th>
                        <th>Precio</th>
                        <th>Estado</th>
                        <th className="align-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.products.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <div className="table-identity">
                              <span className="product-thumb">
                                {p.image_path ? (
                                  <img
                                    loading="lazy"
                                    src={mediaUrl(id, p.image_path)}
                                    alt=""
                                  />
                                ) : (
                                  <UtensilsCrossed size={21} />
                                )}
                              </span>
                              <div>
                                <strong>{p.name}</strong>
                                <small>
                                  {p.sku ||
                                    p.description?.slice(0, 60) ||
                                    "Sin descripción"}
                                </small>
                              </div>
                            </div>
                          </td>
                          <td>
                            {data.categories.find((c) => c.id === p.category_id)
                              ?.name || "Sin categoría"}
                          </td>
                          <td>
                            <strong>{money(p.price, r?.currency)}</strong>
                          </td>
                          <td>
                            <Badge
                              tone={
                                !p.is_published
                                  ? "gray"
                                  : p.is_available
                                    ? "green"
                                    : "amber"
                              }
                            >
                              {!p.is_published
                                ? "Borrador"
                                : p.is_available
                                  ? "Publicado"
                                  : "Agotado"}
                            </Badge>
                          </td>
                          <td>
                            <div className="row-actions">
                              <button
                                className="icon-button"
                                title="Editar producto"
                                aria-label={"Editar " + p.name}
                                onClick={() =>
                                  setEditor({ type: "product", value: p })
                                }
                              >
                                <Pencil size={16} />
                              </button>
                              <button
                                className="icon-button"
                                title="Duplicar producto"
                                aria-label={"Duplicar " + p.name}
                                onClick={() =>
                                  mutate("duplicate_product", { id: p.id })
                                }
                              >
                                <Copy size={16} />
                              </button>
                              <button
                                className="icon-button danger-text"
                                title="Eliminar producto"
                                aria-label={"Eliminar " + p.name}
                                onClick={() =>
                                  setConfirm({
                                    action: "delete_product",
                                    id: p.id,
                                    name: p.name,
                                  })
                                }
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Pagination
                pageSize={25}
                total={data.total}
                page={page}
                onChange={setPage}
              />
            </section>
          )}
          {active === "categories" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Organización del menú</h2>
                  <p>El orden define cómo se muestran en tu menú público.</p>
                </div>
                <span className="count-pill">
                  {data.categories.length} categorías
                </span>
              </div>
              {!data.categories.length ? (
                <Empty
                  icon={Layers}
                  title="Todo gran menú tiene un orden"
                  description="Crea tu primera categoría y empieza a organizar tus productos."
                  action={
                    <Button onClick={() => setEditor({ type: "category" })}>
                      <Plus size={16} />
                      Crear categoría
                    </Button>
                  }
                />
              ) : (
                <div className="category-list">
                  {data.categories.map((c) => (
                    <div
                      className={
                        "category-row " + (c.parent_id ? "is-child" : "")
                      }
                      key={c.id}
                    >
                      <span className="category-order">{c.sort_order}</span>
                      <Layers size={19} />
                      <div>
                        <strong>{c.name}</strong>
                        <small>
                          {c.parent_id
                            ? "Dentro de " +
                              (data.categories.find((p) => p.id === c.parent_id)
                                ?.name || "categoría")
                            : "Categoría principal"}
                        </small>
                      </div>
                      <Badge tone={c.is_visible ? "green" : "gray"}>
                        {c.is_visible ? "Visible" : "Oculta"}
                      </Badge>
                      <button
                        className="icon-button"
                        aria-label={"Editar " + c.name}
                        onClick={() =>
                          setEditor({ type: "category", value: c })
                        }
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="icon-button danger-text"
                        aria-label={"Eliminar " + c.name}
                        onClick={() =>
                          setConfirm({
                            action: "delete_category",
                            id: c.id,
                            name: c.name,
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          {active === "promotions" &&
            (!data.promotions.length ? (
              <section className="panel">
                <Empty
                  icon={Megaphone}
                  title="Comparte algo especial"
                  description="Crea una promoción y elige cuándo aparecerá en tu menú."
                  action={
                    <Button onClick={() => setEditor({ type: "promotion" })}>
                      <Plus size={16} />
                      Crear promoción
                    </Button>
                  }
                />
              </section>
            ) : (
              <div className="promotion-grid">
                {data.promotions.map((p) => (
                  <article className="panel promotion-card" key={p.id}>
                    <div>
                      <Megaphone size={22} />
                      <Badge tone={p.is_active ? "green" : "gray"}>
                        {p.is_active ? "Activada" : "Desactivada"}
                      </Badge>
                    </div>
                    <h2>{p.title}</h2>
                    <p>{p.description}</p>
                    <small>
                      {p.starts_at
                        ? new Date(p.starts_at).toLocaleDateString("es-CO")
                        : "Desde ahora"}{" "}
                      ·{" "}
                      {p.ends_at
                        ? new Date(p.ends_at).toLocaleDateString("es-CO")
                        : "Sin fecha final"}
                    </small>
                    <div className="form-footer">
                      <Button
                        variant="secondary small"
                        onClick={() =>
                          setEditor({ type: "promotion", value: p })
                        }
                      >
                        <Pencil size={14} />
                        Editar
                      </Button>
                      <button
                        className="icon-button danger-text"
                        aria-label={"Eliminar " + p.title}
                        onClick={() =>
                          setConfirm({
                            action: "delete_promotion",
                            id: p.id,
                            name: p.title,
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ))}
          {active === "appearance" && (
            <AppearancePanel
              key={JSON.stringify(data.settings.draft_appearance)}
              data={data}
              mutate={mutate}
              busy={busy}
            />
          )}
          {active === "hours" && (
            <HoursPanel data={data} mutate={mutate} busy={busy} />
          )}
          {active === "languages" && (
            <LanguagesPanel data={data} mutate={mutate} busy={busy} />
          )}
          {active === "qr" && (
            <QrPanel
              data={data}
              mutate={mutate}
              busy={busy}
              support={support}
            />
          )}
          {active === "domains" && support && (
            <DomainsPanel data={data} mutate={mutate} busy={busy} />
          )}
          {active === "import" && <ImportPanel data={data} onComplete={load} />}
          {active === "account" && (
            <AccountPanel
              data={data}
              support={support}
              busy={busy}
              adminAction={adminAction}
            />
          )}
        </>
      )}
      {editor && data && (
        <Modal
          wide
          title={
            editor.type === "product"
              ? editor.value
                ? "Editar producto"
                : "Nuevo producto"
              : editor.type === "category"
                ? editor.value
                  ? "Editar categoría"
                  : "Nueva categoría"
                : editor.value
                  ? "Editar promoción"
                  : "Nueva promoción"
          }
          onClose={() => setEditor(null)}
        >
          {error && <Notice error message={error} />}
          <EntityEditor
            editor={editor}
            data={data}
            onSave={saveEditor}
            busy={busy}
            onCancel={() => setEditor(null)}
          />
        </Modal>
      )}
      {confirm && (
        <Modal title="Confirmar eliminación" onClose={() => setConfirm(null)}>
          <p>
            Vas a eliminar <strong>{confirm.name}</strong>. Revisa que ya no lo
            necesites antes de continuar.
          </p>
          {confirm.action === "delete_category" && (
            <p className="helper-text">
              No se puede eliminar una categoría mientras tenga productos o
              subcategorías asociados.
            </p>
          )}
          <div className="form-footer">
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              busy={busy}
              onClick={async () => {
                if (await mutate(confirm.action, { id: confirm.id }))
                  setConfirm(null);
              }}
            >
              Eliminar
            </Button>
          </div>
        </Modal>
      )}
    </Shell>
  );
}
function EntityEditor({
  editor,
  data,
  onSave,
  busy,
  onCancel,
}: {
  editor: {
    type: "product" | "category" | "promotion";
    value?: Product | Category | Promotion;
  };
  data: WorkspaceData;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  busy: boolean;
  onCancel: () => void;
}) {
  const p =
    editor.type === "product"
      ? (editor.value as Product | undefined)
      : undefined;
  const c =
    editor.type === "category"
      ? (editor.value as Category | undefined)
      : undefined;
  const promo =
    editor.type === "promotion"
      ? (editor.value as Promotion | undefined)
      : undefined;
  const [image, setImage] = useState(p?.image_path || "");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  async function upload(file: File) {
    setUploading(true);
    setUploadError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await api<{ path: string }>(
        "/api/workspace/" + data.restaurant.id + "/media",
        { method: "POST", body },
      );
      setImage(result.path);
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const raw = Object.fromEntries(f);
    const payload: Record<string, unknown> = { ...raw, id: editor.value?.id };
    if (editor.type === "product") {
      Object.assign(payload, {
        price: Number(raw.price),
        sort_order: Number(raw.sort_order),
        category_id: raw.category_id || null,
        image_path: image,
        tags: String(raw.tags)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        is_published: f.has("is_published"),
        is_available: f.has("is_available"),
        is_featured: f.has("is_featured"),
        variants: parseOptions(String(raw.variants)),
        extras: parseOptions(String(raw.extras)),
      });
    } else if (editor.type === "category") {
      Object.assign(payload, {
        parent_id: raw.parent_id || null,
        sort_order: Number(raw.sort_order),
        is_visible: f.has("is_visible"),
      });
    } else
      Object.assign(payload, {
        is_active: f.has("is_active"),
        starts_at: raw.starts_at
          ? new Date(String(raw.starts_at)).toISOString()
          : null,
        ends_at: raw.ends_at
          ? new Date(String(raw.ends_at)).toISOString()
          : null,
      });
    await onSave(payload);
  }
  function parseOptions(value: string) {
    return value
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        const parts = l.split("|");
        return { name: parts[0].trim(), price: Number(parts[1] || 0) };
      });
  }
  return (
    <form className="form-stack" onSubmit={submit}>
      {editor.type === "product" ? (
        <>
          <div className="product-editor-top">
            <div className="upload-box">
              {image ? (
                <img
                  src={mediaUrl(data.restaurant.id, image)}
                  alt="Imagen del producto"
                />
              ) : (
                <ImagePlus size={32} />
              )}
              <label className="button secondary small">
                {uploading
                  ? "Subiendo…"
                  : image
                    ? "Cambiar foto"
                    : "Añadir fotografía"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={uploading}
                  onChange={(e) =>
                    e.target.files?.[0] && upload(e.target.files[0])
                  }
                />
              </label>
              <small>JPG, PNG o WebP · hasta 5 MB</small>
              {image && (
                <button
                  className="text-button danger-text"
                  type="button"
                  onClick={() => setImage("")}
                >
                  Quitar imagen
                </button>
              )}
            </div>
            <div className="form-stack">
              <Field label="Nombre del producto">
                <input
                  name="name"
                  required
                  maxLength={160}
                  defaultValue={p?.name || ""}
                  aria-label="Nombre del producto"
                />
              </Field>
              <Field label="Categoría">
                <select
                  name="category_id"
                  required
                  defaultValue={p?.category_id || ""}
                  aria-label="Categoría"
                >
                  <option value="">Seleccionar categoría</option>
                  {data.categories.map((x) => (
                    <option value={x.id} key={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="form-grid">
                <Field label={"Precio (" + data.restaurant.currency + ")"}>
                  <input
                    name="price"
                    type="number"
                    min="0"
                    step=".01"
                    required
                    defaultValue={p?.price ?? ""}
                    aria-label="Precio"
                  />
                </Field>
                <Field label="Código / SKU">
                  <input
                    name="sku"
                    defaultValue={p?.sku || ""}
                    maxLength={80}
                    aria-label="Código SKU"
                  />
                </Field>
              </div>
            </div>
          </div>
          {uploadError && <Notice error message={uploadError} />}
          <Field label="Descripción">
            <textarea
              name="description"
              rows={3}
              defaultValue={p?.description || ""}
              maxLength={4000}
              aria-label="Descripción"
            />
          </Field>
          <div className="form-grid">
            <Field label="Ingredientes">
              <textarea
                name="ingredients"
                rows={2}
                defaultValue={p?.ingredients || ""}
                aria-label="Ingredientes"
              />
            </Field>
            <Field
              label="Etiquetas"
              hint="Separadas por comas; por ejemplo, vegetariano, picante."
            >
              <input
                name="tags"
                defaultValue={p?.tags?.join(", ") || ""}
                aria-label="Etiquetas"
              />
            </Field>
          </div>
          <div className="form-grid">
            <Field
              label="Presentaciones / variantes"
              hint="Una por línea: nombre | precio. Ejemplo: Grande | 25000"
            >
              <textarea
                name="variants"
                rows={3}
                defaultValue={
                  p?.variants
                    ?.map((o) => o.name + " | " + o.price)
                    .join("\n") || ""
                }
                aria-label="Presentaciones y precios"
              />
            </Field>
            <Field
              label="Extras"
              hint="Uno por línea: nombre | precio adicional."
            >
              <textarea
                name="extras"
                rows={3}
                defaultValue={
                  p?.extras?.map((o) => o.name + " | " + o.price).join("\n") ||
                  ""
                }
                aria-label="Extras y precios"
              />
            </Field>
          </div>
          <Field label="Orden en el menú">
            <input
              className="input-short"
              name="sort_order"
              type="number"
              min={0}
              step={1}
              defaultValue={p?.sort_order || 0}
              aria-label="Orden en el menú"
            />
          </Field>
          <div className="checks-row">
            <Checkbox
              name="is_published"
              label="Publicado"
              defaultChecked={p?.is_published ?? true}
            />
            <Checkbox
              name="is_available"
              label="Disponible"
              defaultChecked={p?.is_available ?? true}
            />
            <Checkbox
              name="is_featured"
              label="Destacado"
              defaultChecked={p?.is_featured ?? false}
            />
          </div>
        </>
      ) : editor.type === "category" ? (
        <>
          <Field label="Nombre de la categoría">
            <input
              name="name"
              required
              maxLength={120}
              defaultValue={c?.name || ""}
              aria-label="Nombre de la categoría"
            />
          </Field>
          <Field label="Categoría principal">
            <select
              name="parent_id"
              defaultValue={c?.parent_id || ""}
              aria-label="Categoría principal"
            >
              <option value="">Ninguna · categoría principal</option>
              {data.categories
                .filter((x) => x.id !== c?.id && !x.parent_id)
                .map((x) => (
                  <option value={x.id} key={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Orden">
            <input
              type="number"
              name="sort_order"
              min={0}
              step={1}
              defaultValue={c?.sort_order || 0}
              aria-label="Orden"
            />
          </Field>
          <Checkbox
            name="is_visible"
            label="Visible en el menú"
            defaultChecked={c?.is_visible ?? true}
          />
        </>
      ) : (
        <>
          <Field label="Título">
            <input
              name="title"
              required
              defaultValue={promo?.title || ""}
              maxLength={160}
              aria-label="Título"
            />
          </Field>
          <Field label="Descripción">
            <textarea
              name="description"
              rows={3}
              defaultValue={promo?.description || ""}
              aria-label="Descripción"
            />
          </Field>
          <div className="form-grid">
            <Field label="Inicio (opcional)">
              <input
                type="datetime-local"
                name="starts_at"
                defaultValue={localDateTime(promo?.starts_at)}
                aria-label="Inicio de promoción"
              />
            </Field>
            <Field label="Fin (opcional)">
              <input
                type="datetime-local"
                name="ends_at"
                defaultValue={localDateTime(promo?.ends_at)}
                aria-label="Fin de promoción"
              />
            </Field>
          </div>
          <Checkbox
            label="Promoción activada"
            name="is_active"
            defaultChecked={promo?.is_active ?? true}
          />
        </>
      )}
      <div className="form-footer">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" busy={busy || uploading}>
          Guardar{" "}
          {editor.type === "product"
            ? "producto"
            : editor.type === "category"
              ? "categoría"
              : "promoción"}
        </Button>
      </div>
    </form>
  );
}
function localDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
