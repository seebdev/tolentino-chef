import { z } from "zod";
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
import { sessionDb, clearSessionCookies } from "@/lib/supabase";
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
      const email = z.email().parse(input.email);
      const password = z.string().min(1).parse(input.password);
      await rateLimit(`login:${email.toLowerCase()}`, 10, 300);
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error)
        throw new ApiError(401, "El correo o la contraseña no son correctos.");
      try {
        const current = await actor();
        await audit(
          current.user.id,
          "login",
          current.membership?.restaurant_id,
        );
        return json({
          ok: true,
          role: current.role,
          redirect: current.role === "superadmin" ? "/admin" : "/dashboard",
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
    const current = await actor();
    const password = z
      .string()
      .min(12, "Usa al menos 12 caracteres.")
      .max(128)
      .parse(input.password);
    const { error } = await db.auth.updateUser({ password });
    if (error)
      throw new ApiError(
        400,
        "No se pudo cambiar la contraseña. Repite el acceso desde el enlace recibido.",
      );
    await audit(
      current.user.id,
      "password_changed",
      current.membership?.restaurant_id,
    );
    return json({ ok: true });
  });
}
