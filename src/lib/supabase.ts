import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { configured } from "./config";
export function serviceDb() {
  if (!configured()) throw new Error("SUPABASE_NOT_CONFIGURED");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export async function sessionDb() {
  if (!configured()) throw new Error("SUPABASE_NOT_CONFIGURED");
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      },
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (values) => {
          for (const { name, value, options } of values)
            jar.set(name, value, options);
        },
      },
    },
  );
}

// Route handlers must clear the request's local cookies even when Auth cannot
// refresh/revoke the session. Cookie names follow the installed SDK's storage key.
export async function clearSessionCookies() {
  const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(
    ".",
  )[0];
  const base = `sb-${project}-auth-token`;
  const jar = await cookies();
  for (const { name } of jar.getAll()) {
    if (!name.startsWith(base)) continue;
    const suffix = name.slice(base.length);
    if (
      !/^(?:|\.\d+|-code-verifier(?:\.\d+)?|-flows-code-verifier(?:\.\d+)?|-flow-[A-Za-z0-9_-]{8,64}-code-verifier(?:\.\d+)?)$/.test(
        suffix,
      )
    )
      continue;
    jar.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    });
  }
}
