"use client";
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  X,
  LoaderCircle,
  CircleAlert,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  UtensilsCrossed,
  LogOut,
  Menu,
  ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error(
      "No se pudo conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.",
    );
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.pending === true || data.ok === false)
    throw Object.assign(
      new Error(
        data.error ||
          data.message ||
          "No se pudo completar la solicitud. Inténtalo de nuevo.",
      ),
      {
        status: res.status,
        code: data.code,
        fields: data.fields,
        pending: data.pending,
      },
    );
  return data as T;
}
export const post = <T,>(url: string, body: unknown) =>
  api<T>(url, { method: "POST", body: JSON.stringify(body) });
export function Brand({ light = false }: { light?: boolean }) {
  return (
    <a
      href="/"
      className={"brand " + (light ? "brand-light" : "")}
      aria-label="Tolentino, inicio"
    >
      <span className="brand-symbol">
        <UtensilsCrossed size={22} />
      </span>
      <span>
        tolentino<span className="brand-caption">RESTAURANTES ADMIN</span>
      </span>
    </a>
  );
}
export function Button({
  children,
  variant = "",
  busy = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: string;
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
      className={"button " + variant + " " + (props.className || "")}
    >
      {busy ? <LoaderCircle size={17} className="spin" /> : null}
      {children}
    </button>
  );
}
function labelControl(node: ReactNode, id: string): ReactNode {
  if (!isValidElement<{ id?: string; children?: ReactNode }>(node)) return node;
  if (
    typeof node.type === "string" &&
    ["input", "select", "textarea"].includes(node.type)
  )
    return cloneElement(node, { id: node.props.id || id });
  if (node.props.children)
    return cloneElement(
      node,
      {},
      Children.map(node.props.children, (child) => labelControl(child, id)),
    );
  return node;
}
export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={"field " + className}>
      <label htmlFor={id}>{label}</label>
      <div>{Children.map(children, (child) => labelControl(child, id))}</div>
      {hint && <small>{hint}</small>}
    </div>
  );
}
export function Notice({
  message,
  error = false,
  onClose,
}: {
  message: string;
  error?: boolean;
  onClose?: () => void;
}) {
  return (
    <div
      className={"notice " + (error ? "notice-error" : "")}
      role={error ? "alert" : "status"}
    >
      {error ? <CircleAlert size={19} /> : <CheckCircle2 size={19} />}
      <span>{message}</span>
      {onClose && (
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Cerrar aviso"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
export function Loading({ text = "Cargando tu espacio…" }: { text?: string }) {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={26} />
      <p>{text}</p>
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
  icon: Icon = UtensilsCrossed,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={28} strokeWidth={1.5} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  closeLabel = "Cerrar",
  preventClose = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  closeLabel?: string;
  preventClose?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      className={"modal " + (wide ? "modal-wide" : "")}
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        if (!preventClose) onClose();
      }}
      aria-labelledby={id}
    >
      <div className="modal-heading">
        <h2 id={id}>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label={closeLabel}
          disabled={preventClose}
          type="button"
        >
          <X size={20} />
        </button>
      </div>
      <div className="modal-content">{children}</div>
    </dialog>
  );
}
export function Badge({
  children,
  tone = "green",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={"badge " + tone}>
      <span />
      {children}
    </span>
  );
}
export function Pagination({
  page,
  total,
  pageSize = 50,
  onChange,
}: {
  page: number;
  total: number;
  pageSize?: number;
  onChange: (page: number) => void;
}) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <span>
        {total} registros · Página {page} de {last}
      </span>
      <div>
        <button
          className="icon-button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="Página anterior"
        >
          <ArrowLeft size={17} />
        </button>
        <button
          className="icon-button"
          disabled={page >= last}
          onClick={() => onChange(page + 1)}
          aria-label="Página siguiente"
        >
          <ArrowRight size={17} />
        </button>
      </div>
    </div>
  );
}
export type NavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  group?: string;
};
export function Shell({
  children,
  items,
  active,
  onNavigate,
  name,
  subtitle = "Administración",
  support = false,
  headerAction,
}: {
  children: ReactNode;
  items: NavItem[];
  active: string;
  onNavigate: (id: string) => void;
  name: string;
  subtitle?: string;
  support?: boolean;
  headerAction?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    try {
      await post("/api/auth", { action: "logout" });
      window.location.assign("/login");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="app-shell">
      {open && (
        <button
          className="sidebar-backdrop"
          onClick={() => setOpen(false)}
          aria-label="Cerrar navegación"
        />
      )}
      <aside className={"sidebar " + (open ? "is-open" : "")}>
        <Brand />
        <div className="workspace-label">
          <span className="workspace-avatar">
            {name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{name}</strong>
            <small>{subtitle}</small>
          </div>
        </div>
        <nav aria-label="Navegación principal">
          {items.map((item, i) => (
            <div key={item.id}>
              {item.group && item.group !== items[i - 1]?.group && (
                <p className="nav-group">{item.group}</p>
              )}
              <button
                className={"nav-item " + (active === item.id ? "active" : "")}
                onClick={() => {
                  onNavigate(item.id);
                  setOpen(false);
                }}
              >
                <item.icon size={19} />
                {item.label}
                {active === item.id && <ChevronRight size={15} />}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="status-dot" />
            Un menú. Muchas posibilidades.
            <small>El control de tu restaurante, en un lugar.</small>
          </div>
          <button className="nav-item" onClick={logout}>
            <LogOut size={18} />
            Cerrar sesión
          </button>
          <span className="sidebar-copyright">
            © {new Date().getFullYear()} Tolentino
          </span>
        </div>
      </aside>
      <div className="app-content">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              aria-label="Abrir navegación"
              onClick={() => setOpen(true)}
            >
              <Menu size={22} />
            </button>
            <span>{subtitle}</span>
            <ChevronRight size={14} />
            <strong>
              {items.find((x) => x.id === active)?.label || "Inicio"}
            </strong>
          </div>
          <div className="topbar-actions">
            {headerAction}
            <span className="profile-avatar">
              {support ? "T" : name.slice(0, 1).toUpperCase()}
            </span>
          </div>
        </header>
        {support && (
          <div className="support-banner">
            <span>
              <strong>Administrando como Tolentino</strong> · {name}
            </span>
            <a href="/admin">
              Volver a restaurantes <ArrowRight size={14} />
            </a>
          </div>
        )}
        <main className="main-content">
          {error && (
            <Notice message={error} error onClose={() => setError("")} />
          )}{" "}
          {children}
        </main>
      </div>
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Stat({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: LucideIcon;
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">
        {label}
        <Icon size={19} />
      </div>
      <strong className="stat-number">{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
export function Check({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="check">
      <input type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}
