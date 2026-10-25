"use client";
import {
  useEffect,
  useState,
  useCallback,
  useRef,
  type FormEvent,
} from "react";
import {
  LayoutDashboard,
  Store,
  Settings,
  Activity,
  Plus,
  Search,
  ArrowUpRight,
  ArrowRight,
  Users,
  Package,
  CirclePause,
  Pencil,
  Copy,
  KeyRound,
  Shield,
  Check,
  Globe,
  RefreshCw,
} from "lucide-react";
import {
  api,
  post,
  Shell,
  PageHeading,
  Stat,
  Button,
  Badge,
  Field,
  Notice,
  Empty,
  Loading,
  Modal,
  Pagination,
} from "./ui";
import { OwnerAccessDialog } from "./owner-access-dialog";
import { mediaUrl, type Restaurant, type Session } from "@/lib/types";
type AdminData = {
  restaurants: Restaurant[];
  stats: Record<string, number>;
  total: number;
  platform: Record<string, string>;
  configured: boolean;
};
const languageOptions = [
  ["es", "Español"],
  ["en", "English"],
  ["fr", "Français"],
  ["it", "Italiano"],
  ["zh", "中文"],
  ["ja", "日本語"],
  ["hi", "हिन्दी"],
];
const nav = [
  {
    id: "overview",
    label: "Vista general",
    icon: LayoutDashboard,
    group: "PLATAFORMA",
  },
  {
    id: "restaurants",
    label: "Restaurantes",
    icon: Store,
    group: "PLATAFORMA",
  },
  { id: "settings", label: "Configuración", icon: Settings, group: "GESTIÓN" },
  {
    id: "health",
    label: "Estado del servicio",
    icon: Activity,
    group: "GESTIÓN",
  },
];
export function AdminApp() {
  const [active, setActive] = useState("overview");
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<Restaurant | "new" | null>(null);
  const [accessOwner, setAccessOwner] = useState<Restaurant | null>(null);
  const [busy, setBusy] = useState(false);
  const mutationInFlight = useRef(false);
  const createAttempt = useRef<{ signature: string; requestId: string } | null>(
    null,
  );
  const [demo, setDemo] = useState(false);
  function openEditor(value: Restaurant | "new") {
    setError("");
    setDemo(false);
    setEditor(value);
  }
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [targetId, setTargetId] = useState("");
  const [targetQuery, setTargetQuery] = useState("");
  const [targets, setTargets] = useState<Restaurant[]>([]);
  const [confirm, setConfirm] = useState<{
    action: string;
    restaurant: Restaurant;
  } | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api<Session>("/api/session");
      if (s.role !== "superadmin") {
        window.location.replace("/dashboard");
        return;
      }
      const d = await api<AdminData>(
        "/api/admin/restaurants?q=" +
          encodeURIComponent(q) +
          "&status=" +
          status +
          "&page=" +
          page,
      );
      setData(d);
      setError("");
    } catch (e) {
      if ((e as Error & { status?: number }).status === 401) {
        window.location.replace("/login");
        return;
      }
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [q, status, page]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  useEffect(() => {
    if (confirm?.action !== "duplicate") return;
    const timer = setTimeout(() => {
      api<AdminData>(
        "/api/admin/restaurants?q=" + encodeURIComponent(targetQuery),
      )
        .then((d) =>
          setTargets(
            d.restaurants.filter((r) => r.id !== confirm.restaurant.id),
          ),
        )
        .catch((e) => setError((e as Error).message));
    }, 200);
    return () => clearTimeout(timer);
  }, [confirm, targetQuery]);
  async function action(name: string, r: Restaurant) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await post<{ message?: string }>(
        "/api/admin/restaurants",
        {
          action: name,
          restaurantId: r.id,
          data:
            name === "duplicate"
              ? { targetRestaurantId: targetId }
              : { status: r.status === "active" ? "suspended" : "active" },
        },
      );
      setMessage(result.message || "Cambio guardado correctamente.");
      setConfirm(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (mutationInFlight.current) return;
    const form = e.currentTarget;
    if (!form.reportValidity()) return;
    const raw = Object.fromEntries(new FormData(form));
    const payload = {
      ...raw,
      demo: editor === "new" ? raw.demo === "on" : undefined,
      sale_amount:
        raw.sale_amount === undefined || raw.sale_amount === ""
          ? undefined
          : Number(raw.sale_amount),
    };
    const creating = editor === "new";
    let requestId: string | undefined;
    if (creating) {
      const signature = JSON.stringify(payload);
      if (createAttempt.current?.signature !== signature)
        createAttempt.current = { signature, requestId: crypto.randomUUID() };
      requestId = createAttempt.current.requestId;
    }
    mutationInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await post<{ message?: string }>(
        "/api/admin/restaurants",
        {
          action: creating ? "create" : "update",
          ...(requestId ? { requestId } : {}),
          restaurantId: editor && editor !== "new" ? editor.id : undefined,
          data: payload,
        },
      );
      if (creating) createAttempt.current = null;
      setEditor(null);
      setMessage(
        result.message ||
          (editor === "new"
            ? "Restaurante creado."
            : "Datos del restaurante actualizados."),
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  }
  async function settings(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusy(true);
    try {
      await post("/api/admin/restaurants", {
        action: "platform",
        data: Object.fromEntries(new FormData(e.currentTarget)),
      });
      setMessage("Configuración de Tolentino guardada.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  }
  async function checkHealth() {
    setBusy(true);
    try {
      const response = await fetch("/api/health");
      const d = await response.json();
      setHealth(d);
      if (!response.ok) setError(d.error || "El servicio requiere atención.");
    } catch {
      setError("No se pudo consultar el servicio.");
    } finally {
      setBusy(false);
    }
  }
  const stats = data?.stats || {};
  const all = data?.restaurants || [];
  const r = editor && editor !== "new" ? editor : null;
  return (
    <Shell
      items={nav}
      active={active}
      onNavigate={setActive}
      name="Tolentino"
      subtitle="Superadministrador"
      headerAction={
        <span className="role-pill">
          <Shield size={13} />
          Acceso global
        </span>
      }
    >
      <PageHeading
        eyebrow="CENTRO DE CONTROL"
        title={
          active === "overview"
            ? "Cada restaurante, bajo control."
            : active === "restaurants"
              ? "Tus restaurantes."
              : active === "settings"
                ? "La esencia de Tolentino."
                : "Estado del servicio."
        }
        description={
          active === "overview"
            ? "Un vistazo a tu plataforma y a los menús que estás haciendo posibles."
            : active === "restaurants"
              ? "Gestiona clientes, accesos y experiencias desde un solo lugar."
              : active === "settings"
                ? "Define cómo aparece tu marca en los menús de tus clientes."
                : "Comprueba la conexión de los servicios que hacen posible tu plataforma."
        }
        action={
          (active === "overview" || active === "restaurants") && (
            <Button onClick={() => openEditor("new")}>
              <Plus size={18} />
              Nuevo restaurante
            </Button>
          )
        }
      />
      {message && (
        <Notice message={message} onClose={() => setMessage("")} />
      )}{" "}
      {error && <Notice message={error} error onClose={() => setError("")} />}
      {(active === "overview" || active === "restaurants") && (
        <>
          {active === "overview" && (
            <>
              <div className="stats-grid">
                <Stat
                  label="Total de restaurantes"
                  value={stats.total ?? data?.total ?? "—"}
                  detail="Todos tus clientes, en un lugar"
                  icon={Store}
                />
                <Stat
                  label="Restaurantes activos"
                  value={stats.active ?? "—"}
                  detail="Menús disponibles al público"
                  icon={Check}
                />
                <Stat
                  label="Restaurantes suspendidos"
                  value={stats.suspended ?? "—"}
                  detail="Conservan toda su información"
                  icon={CirclePause}
                />
                <Stat
                  label="Productos publicados"
                  value={
                    stats.publishedProducts ?? stats.published_products ?? "—"
                  }
                  detail="Listos para descubrir"
                  icon={Package}
                />
              </div>
              <div className="metrics-strip">
                <span>
                  <strong>{stats.qr ?? stats.qr_generated ?? "—"}</strong>QR
                  permanentes
                </span>
                <span>
                  <strong>{stats.visits ?? stats.menu_views ?? "—"}</strong>
                  visitas registradas
                </span>
                <span>
                  <strong>{stats.scans ?? stats.qr_scans ?? "—"}</strong>
                  escaneos del QR
                </span>
                <button
                  className="text-button"
                  onClick={() => setActive("health")}
                >
                  Comprobar el servicio <Activity size={14} />
                </button>
              </div>
              <div className="welcome-strip">
                <div className="welcome-mark">
                  <UtensilMark />
                </div>
                <div>
                  <span className="eyebrow">CRECER, SIN COMPLICACIONES</span>
                  <h2>El próximo gran menú empieza aquí.</h2>
                  <p>
                    Crea un restaurante, dale su identidad y comparte su QR
                    permanente.
                  </p>
                </div>
                <button
                  className="text-button"
                  onClick={() => openEditor("new")}
                >
                  Empezar <ArrowRight size={18} />
                </button>
              </div>
            </>
          )}
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>
                  {active === "overview"
                    ? "Tus restaurantes"
                    : "Directorio de restaurantes"}
                </h2>
                <p>
                  {data?.total ?? 0} clientes · una misma experiencia completa
                </p>
              </div>
              <span className="panel-label">SIN SUSCRIPCIONES</span>
            </div>
            <div className="filter-bar">
              <div className="search-input">
                <Search size={18} />
                <input
                  placeholder="Buscar restaurante, propietario o correo…"
                  aria-label="Buscar restaurantes"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <select
                aria-label="Filtrar por estado"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Todos los estados</option>
                <option value="active">Activos</option>
                <option value="suspended">Suspendidos</option>
              </select>
            </div>
            {loading ? (
              <Loading />
            ) : all.length === 0 ? (
              <Empty
                title={
                  q || status
                    ? "No hay coincidencias"
                    : "Aquí comienza tu próximo restaurante"
                }
                description={
                  q || status
                    ? "Cambia la búsqueda o el filtro para encontrar otros resultados."
                    : "Crea tu primer cliente y comienza a construir su menú digital."
                }
                action={
                  !q &&
                  !status && (
                    <Button onClick={() => openEditor("new")}>
                      <Plus size={17} />
                      Crear primer restaurante
                    </Button>
                  )
                }
              />
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Restaurante</th>
                      <th>Propietario</th>
                      <th>Estado</th>
                      <th>Creado</th>
                      <th className="align-right">Administrar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {all.map((rest) => (
                      <tr key={rest.id}>
                        <td>
                          <div className="table-identity">
                            <span className="restaurant-initial">
                              {rest.logo_path ? (
                                <img
                                  src={mediaUrl(rest.id, rest.logo_path)}
                                  alt=""
                                />
                              ) : (
                                rest.name.slice(0, 2).toUpperCase()
                              )}
                            </span>
                            <div>
                              <strong>{rest.name}</strong>
                              <small>
                                <a
                                  href={"/menu/" + rest.slug}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  /menu/{rest.slug} ↗
                                </a>
                              </small>
                              {rest.restaurant_domains
                                ?.filter((d) => d.status === "verified")
                                .map((d) => (
                                  <small key={d.hostname}>{d.hostname}</small>
                                ))}
                            </div>
                          </div>
                        </td>
                        <td>
                          <strong className="normal-weight">
                            {rest.owner_name || "Sin nombre"}
                          </strong>
                          <small>{rest.owner_email}</small>
                        </td>
                        <td>
                          <Badge
                            tone={rest.status === "active" ? "green" : "amber"}
                          >
                            {rest.status === "active" ? "Activo" : "Suspendido"}
                          </Badge>
                          <small>{rest.product_count ?? "—"} productos</small>
                        </td>
                        <td className="muted">
                          {new Date(rest.created_at).toLocaleDateString(
                            "es-CO",
                            { day: "numeric", month: "short", year: "numeric" },
                          )}
                          <small>
                            Venta:{" "}
                            {rest.sale_date
                              ? new Date(rest.sale_date).toLocaleDateString(
                                  "es-CO",
                                )
                              : "Sin registrar"}
                          </small>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button className="button small secondary" onClick={() => setAccessOwner(rest)} aria-label={"Acceso del propietario de " + rest.name}><KeyRound size={16}/> Acceso del propietario</button>
                            <a
                              className="button small secondary"
                              href={"/admin/restaurants/" + rest.id}
                            >
                              Administrar <ArrowUpRight size={15} />
                            </a>
                            <button
                              className="icon-button"
                              onClick={() => openEditor(rest)}
                              aria-label={"Editar " + rest.name}
                              title="Editar datos"
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              className="icon-button"
                              onClick={() =>
                                setConfirm({
                                  action: "status",
                                  restaurant: rest,
                                })
                              }
                              aria-label={
                                rest.status === "active"
                                  ? "Suspender restaurante"
                                  : "Reactivar restaurante"
                              }
                              title={
                                rest.status === "active"
                                  ? "Suspender"
                                  : "Reactivar"
                              }
                            >
                              {rest.status === "active" ? (
                                <CirclePause size={16} />
                              ) : (
                                <Check size={16} />
                              )}
                            </button>
                            <button
                              className="icon-button"
                              title="Copiar diseño"
                              aria-label={"Duplicar " + rest.name}
                              onClick={() => {
                                setTargetId("");
                                setTargetQuery("");
                                setConfirm({
                                  action: "duplicate",
                                  restaurant: rest,
                                });
                              }}
                            >
                              <Copy size={16} />
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
              pageSize={20}
              total={data?.total || 0}
              page={page}
              onChange={setPage}
            />
          </section>
          {active === "overview" && (
            <div className="bottom-cards">
              <div className="mini-panel">
                <QrMark />
                <div>
                  <h3>Un QR para siempre</h3>
                  <p>
                    Cambia el menú, el nombre o el dominio. El código de tu
                    cliente sigue conectado.
                  </p>
                </div>
              </div>
              <div className="mini-panel">
                <Users size={23} />
                <div>
                  <h3>Cada cliente, su espacio</h3>
                  <p>
                    Accesos individuales y datos separados para una
                    administración segura.
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      {accessOwner && <OwnerAccessDialog restaurantId={accessOwner.id} name={accessOwner.name} onClose={() => setAccessOwner(null)} />}
      {active === "settings" && (
        <form className="panel form-panel" onSubmit={settings}>
          <div className="section-heading">
            <h2>Contacto comercial</h2>
            <p>
              Un enlace discreto en el pie de cada menú. Solo tú puedes
              modificarlo.
            </p>
          </div>
          <Field label="Marca del creador"><input name="creator_brand" aria-label="Marca del creador" required maxLength={80} defaultValue={data?.platform?.creator_brand || "Tolentino Chef"} /></Field>
          <Field label="Teléfono del creador"><input name="creator_phone" aria-label="Teléfono del creador" required maxLength={24} defaultValue={data?.platform?.creator_phone || "3108853158"} /></Field>
          <Field label="WhatsApp del creador" hint="Enlace HTTPS de wa.me; sólo abre la conversación cuando el visitante lo elige."><input name="creator_whatsapp" aria-label="WhatsApp del creador" type="url" required defaultValue={data?.platform?.creator_whatsapp || "https://wa.me/573108853158?text=Hola%2C%20quiero%20informaci%C3%B3n%20sobre%20un%20men%C3%BA%20digital%20para%20mi%20restaurante"} /></Field>
          <Field label="Texto del enlace">
            <input
              name="contact_label"
              defaultValue={
                data?.platform?.contact_label || "Menú digital por Tolentino"
              }
              required
              maxLength={100}
              aria-label="Texto del enlace"
            />
          </Field>
          <Field
            label="Destino del contacto"
            hint="Usa una dirección HTTPS de contacto o WhatsApp. Si está vacío, no se mostrará el enlace."
          >
            <input
              name="contact_url"
              type="url"
              defaultValue={data?.platform?.contact_url || ""}
              placeholder="https://…"
              aria-label="Destino del contacto"
            />
          </Field>
          <Field label="Mensaje para restaurantes suspendidos">
            <textarea
              name="suspension_message"
              defaultValue={
                data?.platform?.suspension_message ||
                "Este menú no está disponible temporalmente."
              }
              rows={3}
              aria-label="Mensaje para restaurantes suspendidos"
            />
          </Field>
          <div className="form-footer">
            <Button type="submit" busy={busy}>
              Guardar configuración
            </Button>
          </div>
        </form>
      )}
      {active === "health" && (
        <section className="panel form-panel">
          <div className="section-heading">
            <h2>Conexión de la plataforma</h2>
            <p>La comprobación consulta el estado actual del servidor.</p>
          </div>
          <div className="health-row">
            <Globe size={22} />
            <div>
              <strong>Servicios de Tolentino</strong>
              <p>
                {health
                  ? String(health.status || "Comprobación recibida")
                  : "Aún no has ejecutado una comprobación en esta sesión."}
              </p>
            </div>
            <Button variant="secondary" busy={busy} onClick={checkHealth}>
              <RefreshCw size={16} />
              Comprobar
            </Button>
          </div>
          {health && (
            <dl className="details-list">
              {Object.entries(health)
                .filter(([, v]) => typeof v !== "object")
                .map(([key, value]) => (
                  <div key={key}>
                    <dt>
                      {{
                        status: "Estado",
                        configured: "Configuración",
                        database: "Base de datos",
                        storage: "Imágenes",
                        timestamp: "Fecha de comprobación",
                      }[key] || key}
                    </dt>
                    <dd>
                      {typeof value === "boolean"
                        ? value
                          ? "Disponible"
                          : "Pendiente"
                        : String(value)}
                    </dd>
                  </div>
                ))}
            </dl>
          )}
          <p className="helper-text">
            Los dominios de cada cliente se comprueban desde su espacio de
            administración.
          </p>
        </section>
      )}
      {editor && (
        <Modal
          title={r ? "Editar restaurante" : "Un nuevo restaurante"}
          preventClose={busy}
          onClose={() => setEditor(null)}
          wide
        >
          {error && <Notice error message={error} />}
          <form className="form-stack" onSubmit={save}>
            <fieldset className="form-stack form-fields" disabled={busy}>
              <div className="form-grid">
                <Field label="Nombre del restaurante">
                  <input
                    name="name"
                    required
                    defaultValue={r?.name || ""}
                    maxLength={120}
                    aria-label="Nombre del restaurante"
                  />
                </Field>
                <Field
                  label="Dirección del menú"
                  hint="Solo letras minúsculas, números y guiones."
                >
                  <input
                    name="slug"
                    required
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    minLength={3}
                    maxLength={64}
                    defaultValue={r?.slug || ""}
                    placeholder="mi-restaurante"
                    aria-label="Dirección del menú"
                  />
                </Field>
                <Field label="Nombre del propietario">
                  <input
                    name="owner_name"
                    required
                    defaultValue={r?.owner_name || ""}
                    aria-label="Nombre del propietario"
                  />
                </Field>
                <Field label="Correo del propietario">
                  <input
                    name="owner_email"
                    type="email"
                    required
                    defaultValue={r?.owner_email || ""}
                    aria-label="Correo del propietario"
                    readOnly={!!r}
                    pattern={!r && demo ? "[^@]+@[^@]+\\.test" : undefined}
                    title={
                      !r && demo
                        ? "Usa un correo de demostración terminado en .test"
                        : undefined
                    }
                  />
                </Field>
                <Field label="Teléfono">
                  <input
                    name="phone"
                    type="tel"
                    defaultValue={r?.phone || ""}
                    aria-label="Teléfono"
                  />
                </Field>
                <Field label="Moneda">
                  <select
                    name="currency"
                    defaultValue={r?.currency || "COP"}
                    aria-label="Moneda"
                  >
                    {[
                      "COP",
                      "USD",
                      "EUR",
                      "MXN",
                      "PEN",
                      "CLP",
                      "ARS",
                      "BRL",
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Descripción">
                <textarea
                  name="description"
                  rows={3}
                  defaultValue={r?.description || ""}
                  aria-label="Descripción"
                />
              </Field>
              <Field label="Idioma principal">
                <select
                  name="default_language"
                  defaultValue={r?.default_language || "es"}
                  aria-label="Idioma principal"
                >
                  {languageOptions.map(([code, label]) => (
                    <option value={code} key={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              {!r && (
                <>
                  <div className="section-divider">
                    REGISTRO DE VENTA · PAGO ÚNICO
                  </div>
                  <div className="form-grid">
                    <Field label="Fecha de venta">
                      <input
                        type="date"
                        name="sale_date"
                        defaultValue={new Date().toLocaleDateString("en-CA")}
                        aria-label="Fecha de venta"
                      />
                    </Field>
                    <Field label="Precio cobrado">
                      <input
                        type="number"
                        name="sale_amount"
                        min={0}
                        step=".01"
                        aria-label="Precio cobrado"
                      />
                    </Field>
                  </div>
                  <Field label="Observaciones internas">
                    <textarea
                      name="sale_notes"
                      rows={2}
                      aria-label="Observaciones internas"
                    />
                  </Field>
                  <label className="check">
                    <input
                      type="checkbox"
                      name="demo"
                      checked={demo}
                      onChange={(event) => setDemo(event.target.checked)}
                    />
                    Crear restaurante DEMO
                  </label>
                  <p className="helper-text">
                    <KeyRound size={15} />
                    {demo
                      ? "Usa un correo terminado en .test. Este modo no envía invitaciones ni comunicaciones externas."
                      : "El propietario recibirá una invitación segura para establecer su contraseña."}
                  </p>
                </>
              )}
              <div className="form-footer">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setEditor(null)}
                >
                  Cancelar
                </Button>
                <Button type="submit" busy={busy}>
                  {r ? "Guardar cambios" : "Crear restaurante"}
                </Button>
              </div>
            </fieldset>
          </form>
        </Modal>
      )}
      {confirm && (
        <Modal
          title={
            confirm.action === "duplicate"
              ? "Copiar diseño"
              : confirm.restaurant.status === "active"
                ? "Suspender restaurante"
                : "Reactivar restaurante"
          }
          onClose={() => setConfirm(null)}
        >
          <p>
            {confirm.action === "duplicate"
              ? "Se copiarán los colores, la tipografía y los idiomas al borrador del restaurante de destino. Las imágenes no se copian entre restaurantes."
              : confirm.restaurant.status === "active"
                ? "El menú público dejará de estar disponible y el propietario no podrá administrar. Los datos se conservarán."
                : "El menú y la administración volverán a estar disponibles."}
          </p>
          <strong>{confirm.restaurant.name}</strong>
          {confirm.action === "duplicate" && (
            <div className="form-stack" style={{ marginTop: 20 }}>
              <Field label="Buscar restaurante de destino">
                <input
                  value={targetQuery}
                  onChange={(e) => setTargetQuery(e.target.value)}
                  aria-label="Buscar restaurante de destino"
                />
              </Field>
              <Field label="Restaurante de destino">
                <select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  aria-label="Restaurante de destino"
                >
                  <option value="">Seleccionar restaurante</option>
                  {targets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          <div className="form-footer">
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancelar
            </Button>
            <Button
              busy={busy}
              disabled={confirm.action === "duplicate" && !targetId}
              onClick={() => action(confirm.action, confirm.restaurant)}
            >
              Confirmar
            </Button>
          </div>
        </Modal>
      )}
    </Shell>
  );
}
function UtensilMark() {
  return <Store size={30} strokeWidth={1.3} />;
}
function QrMark() {
  return <Package size={23} />;
}
