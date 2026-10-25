import { z } from "zod";
import { createHash } from "node:crypto";
import { aliasInput, temporaryPasswordInput } from "@/lib/owner-access";
import { actor, audit } from "@/lib/access";
import {
  route,
  json,
  body,
  mutationOrigin,
  rateLimit,
  clientKey,
  ApiError,
} from "@/lib/api";
import { sessionDb, serviceDb, clearSessionCookies } from "@/lib/supabase";
import { appUrl } from "@/lib/config";
import { LOCAL_LOGOUT_WARNING } from "@/lib/session-messages";

async function endLocalSession(db: Awaited<ReturnType<typeof sessionDb>>) {
  let revoked = false;
  try {
    const { error } = await db.auth.signOut({ scope: "local" });
    revoked = !error;
  } catch {
    // No provider error text or cookie/token data belongs in this response.
  } finally {
    // If cookie cleanup itself fails, propagate the error: do not claim success.
    await clearSessionCookies();
  }
  return revoked;
}

export async function POST(request: Request) {
  return route(async () => {
    mutationOrigin(request);
    const input = z
      .object({
        action: z.enum(["login", "logout", "recover", "password"]),
        identifier: z.string().trim().max(254).optional(),
        email: z.preprocess(
          (v) => (v === "" ? undefined : v),
          z.email().optional(),
        ),
        password: z.string().max(128).optional(),
      })
      .parse(await body(request, 10000));
    const db = await sessionDb();
    if (input.action === "logout") {
      const revoked = await endLocalSession(db);
      if (!revoked)
        return json(
          {
            ok: false,
            code: "AUTH_REVOCATION_UNCONFIRMED",
            localSessionCleared: true,
            error: LOCAL_LOGOUT_WARNING,
          },
          503,
        );
      return json({ ok: true, localSessionCleared: true });
    }
    await rateLimit(`auth-ip:${clientKey(request)}`, 30, 300);
    if (input.action === "login") {
      const identifier = (input.identifier || input.email || "").trim().toLowerCase();
      await rateLimit(`login:${createHash("sha256").update(identifier).digest("hex")}`, 10, 300);
      let email: string;
      let resolved = true;
      if (identifier.includes("@")) email = z.email().parse(identifier);
      else {
        const parsed = aliasInput.safeParse(identifier);
        if (!parsed.success || !parsed.data) throw new ApiError(401, "El correo, usuario o contraseña no son correctos.");
        const lookup = await serviceDb().rpc("resolve_owner_login", { p_alias: parsed.data });
        if (lookup.error) throw new ApiError(503, "No se pudo comprobar el acceso. Reintenta en unos minutos.");
        resolved = typeof lookup.data === "string" && !!lookup.data;
        email = resolved ? lookup.data : "unavailable@invalid.example";
      }
      const password = z.string().min(1).parse(input.password);
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (!resolved && !error) await endLocalSession(db);
      if (error || !resolved)
        throw new ApiError(401, "El correo, usuario o contraseña no son correctos.");
      try {
        const current = await actor({ allowPasswordChange: true });
        await audit(
          current.user.id,
          "login",
          current.membership?.restaurant_id,
        );
        return json({
          ok: true,
          role: current.role,
          requiresPasswordChange: current.requiresPasswordChange,
          redirect: current.requiresPasswordChange ? "/login?mode=password" : current.role === "superadmin" ? "/admin" : "/dashboard",
        });
      } catch (error) {
        await endLocalSession(db);
        throw error;
      }
    }
    if (input.action === "recover") {
      const email = z.email().parse(input.email);
      await rateLimit(`recovery:${email.toLowerCase()}`, 3, 900);
      // Reserved DEMO addresses never invoke the email service. Preserve the
      // generic public response, including provider failure, to avoid enumeration.
      if (!/@[^@]+\.test$/i.test(email)) {
        try {
          const { error } = await db.auth.resetPasswordForEmail(email, {
            redirectTo: appUrl() + "/auth/callback",
          });
          if (error)
            console.warn(
              JSON.stringify({
                event: "auth_recovery_failed",
                stage: "provider",
                code: "PROVIDER_FAILURE",
              }),
            );
        } catch {
          console.warn(
            JSON.stringify({
              event: "auth_recovery_failed",
              stage: "provider",
              code: "PROVIDER_FAILURE",
            }),
          );
        }
      }
      return json({
        ok: true,
        message:
          "Si el correo tiene acceso, recibirás instrucciones para cambiar tu contraseña.",
      });
    }
    const current = await actor({ allowPasswordChange: true });
    const password = temporaryPasswordInput.parse(input.password);
    let sessionId: string | undefined;
    if (current.role === "owner") {
      const { data, error } = await db.auth.getClaims();
      if (error || data?.claims.sub !== current.user.id) throw new ApiError(401, "Inicia sesión de nuevo.");
      sessionId = z.uuid().parse(data?.claims.session_id);
    }
    const { error } = await db.auth.updateUser({ password });
    if (error)
      throw new ApiError(
        400,
        "No se pudo cambiar la contraseña. Repite el acceso desde el enlace recibido.",
      );
    if (current.role === "owner") {
      const completed = await serviceDb().rpc("complete_owner_password_change", {
        p_user_id: current.user.id, p_generation: current.ownerAccessGeneration, p_session_id: sessionId,
      });
      if (completed.error || completed.data !== true)
        throw new ApiError(409, "El acceso cambió durante la operación. Inicia sesión con la contraseña recién establecida y vuelve a cambiarla.", "PASSWORD_CHANGE_STALE");
    }
    await audit(
      current.user.id,
      "password_changed",
      current.membership?.restaurant_id,
    );
    return json({ ok: true, redirect: current.role === "superadmin" ? "/admin" : "/dashboard" });
  });
}
