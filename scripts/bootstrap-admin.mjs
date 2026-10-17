import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
const email = process.argv[2];
if (!email || !email.includes("@"))
  throw new Error(
    "Uso: node --env-file=.env.local scripts/bootstrap-admin.mjs correo@dominio.com",
  );
for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_URL",
])
  if (!process.env[key]) throw new Error(`Falta ${key}`);
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const auth = await db.auth.admin.createUser({
  email,
  password: randomBytes(48).toString("base64url"),
  email_confirm: true,
});
if (auth.error || !auth.data.user)
  throw new Error(
    "No se creó una cuenta nueva. Revisa el correo y el proyecto exclusivo de Tolentino.",
  );
const role = await db
  .from("platform_admins")
  .insert({ user_id: auth.data.user.id, is_active: true });
if (role.error) {
  const cleanup = await db.auth.admin.deleteUser(auth.data.user.id);
  if (cleanup.error)
    console.error(
      "Revisión necesaria: falló la compensación del usuario recién creado.",
    );
  throw new Error("No se pudo asignar el rol. Revisa las migraciones.");
}
const recovery = await db.auth.resetPasswordForEmail(email, {
  redirectTo: new URL("/auth/callback", process.env.APP_URL).toString(),
});
if (recovery.error)
  throw new Error(
    "Administrador creado; falló el envío del correo. Usa Recuperar acceso una vez configurado SMTP.",
  );
console.log(
  "Administrador creado. Revisa el correo para establecer una contraseña.",
);
