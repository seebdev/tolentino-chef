"use client";
import { useEffect, useState, useRef, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowLeft,
  LockKeyhole,
  ShieldCheck,
  UtensilsCrossed,
  QrCode,
  LayoutDashboard,
  Eye,
  EyeOff,
} from "lucide-react";
import { Brand, Button, Field, Notice, api, post } from "./ui";
import type { Session } from "@/lib/types";
export function Login({
  initialMode = "login",
  initialError = "",
}: {
  initialMode?: "login" | "password";
  initialError?: string;
}) {
  const [mode, setMode] = useState<"login" | "recover" | "password">(
    initialMode,
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(initialError);
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    if (initialMode === "password") return;
    api<Session>("/api/session")
      .then((s) =>
        window.location.replace(
          s.role === "superadmin" ? "/admin" : "/dashboard",
        ),
      )
      .catch(() => {});
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.configured === "boolean") setConfigured(d.configured);
      })
      .catch(() => {});
  }, [initialMode]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    setError("");
    setMessage("");
    if (mode === "password" && password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const result = await post<{ role?: string; message?: string }>(
        "/api/auth",
        { action: mode, ...(mode === "password" ? {} : { email }), password },
      );
      if (mode === "login") {
        const s = await api<Session>("/api/session");
        window.location.assign(
          s.role === "superadmin" ? "/admin" : "/dashboard",
        );
      } else if (mode === "password") {
        setMessage("Tu contraseña se actualizó correctamente.");
        setMode("login");
        setPassword("");
      } else
        setMessage(
          result.message ||
            "Si el correo corresponde a una cuenta, recibirás un enlace para recuperar el acceso.",
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <section className="login-story">
        <Brand light />
        <div className="login-story-content">
          <span className="login-kicker">HECHO PARA LA HOSPITALIDAD</span>
          <h1>
            Tu esencia.
            <br />
            Tu menú.
            <br />
            <em>Un solo lugar.</em>
          </h1>
          <p>
            Todo lo que necesitas para cuidar cada detalle de tu experiencia
            digital.
          </p>
          <div className="login-benefits">
            <span>
              <LayoutDashboard size={18} />
              Administración sencilla
            </span>
            <span>
              <UtensilsCrossed size={18} />
              Menús con identidad
            </span>
            <span>
              <QrCode size={18} />
              QR siempre conectado
            </span>
          </div>
        </div>
        <div className="login-story-footer">
          <span>RESTAURANTES, CONECTADOS.</span>
          <span>EST. 2026</span>
        </div>
        <div className="login-orbit orbit-one" />
        <div className="login-orbit orbit-two" />
      </section>
      <section className="login-form-panel">
        <div className="mobile-brand">
          <Brand />
        </div>
        <div className="login-form-wrap">
          <span className="login-lock">
            <LockKeyhole size={23} />
          </span>
          <span className="eyebrow">TU ESPACIO DE ADMINISTRACIÓN</span>
          <h2>
            {mode === "recover"
              ? "Recupera tu acceso"
              : mode === "password"
                ? "Una nueva contraseña"
                : "Qué bueno tenerte aquí."}
          </h2>
          <p className="login-description">
            {mode === "recover"
              ? "Te enviaremos un enlace seguro a tu correo."
              : mode === "password"
                ? "Elige una contraseña de al menos 12 caracteres."
                : "Ingresa para administrar tus restaurantes y dar vida a tus menús."}
          </p>
          {configured === false && (
            <div className="connection-notice">
              <span className="status-dot amber" />
              La plataforma está pendiente de conexión.
              <p>
                El acceso estará disponible cuando Tolentino complete la
                configuración del servicio.
              </p>
            </div>
          )}
          {error && <Notice message={error} error />}
          {message && <Notice message={message} />}
          <form onSubmit={submit} className="form-stack">
            {mode !== "password" && (
              <Field label="Correo electrónico">
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@restaurante.com"
                  aria-label="Correo electrónico"
                />
              </Field>
            )}
            {mode !== "recover" && (
              <Field
                label={mode === "password" ? "Nueva contraseña" : "Contraseña"}
              >
                <div className="password-input">
                  <input
                    type={show ? "text" : "password"}
                    autoComplete={
                      mode === "password" ? "new-password" : "current-password"
                    }
                    minLength={mode === "password" ? 12 : undefined}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Ingresa tu contraseña"
                    aria-label="Contraseña"
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={
                      show ? "Ocultar contraseña" : "Mostrar contraseña"
                    }
                    onClick={() => setShow(!show)}
                  >
                    {show ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </Field>
            )}
            {mode === "password" && (
              <Field label="Confirma tu contraseña">
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  aria-label="Confirma tu contraseña"
                />
              </Field>
            )}
            {mode === "login" && (
              <button
                className="text-button recover-link"
                type="button"
                onClick={() => {
                  setMode("recover");
                  setError("");
                  setMessage("");
                }}
              >
                Olvidé mi contraseña
              </button>
            )}
            <Button
              busy={busy}
              className="login-submit"
              type="submit"
              disabled={configured === false}
            >
              {mode === "recover"
                ? "Enviar enlace"
                : mode === "password"
                  ? "Actualizar contraseña"
                  : "Entrar a mi espacio"}
              <ArrowRight size={18} />
            </Button>
            {mode !== "login" && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setMode("login");
                  setError("");
                  setMessage("");
                }}
              >
                <ArrowLeft size={15} />
                Volver a iniciar sesión
              </button>
            )}
          </form>
          <div className="private-access">
            <ShieldCheck size={17} />
            <p>
              Acceso privado para clientes de Tolentino.
              <br />
              Las cuentas se crean por invitación.
            </p>
          </div>
        </div>
        <footer className="login-footer">
          © {new Date().getFullYear()} Tolentino · Cada detalle cuenta.
        </footer>
      </section>
    </main>
  );
}
