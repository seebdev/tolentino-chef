import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { configured } from "./config";

const sessionPaths = [
  "/login",
  "/admin",
  "/dashboard",
  "/auth",
  "/api/session",
  "/api/auth",
  "/api/admin",
  "/api/workspace",
  "/api/media",
];

export function usesSession(pathname: string) {
  return sessionPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/** Refresh only after the proxy has accepted the platform hostname. */
export async function refreshSession(request: NextRequest) {
  const pendingCookies = new Map<
    string,
    { name: string; value: string; options: CookieOptions }
  >();
  const responseHeaders = new Headers({
    "Cache-Control": "private, no-store",
  });

  if (configured()) {
    // A client must belong to one request: refresh tokens and cache headers
    // must never be shared with another visitor.
    const supabase = createServerClient(
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
          getAll: () => request.cookies.getAll(),
          setAll: (values, headers) => {
            for (const cookie of values) {
              if (cookie.options.maxAge === 0)
                request.cookies.delete(cookie.name);
              else request.cookies.set(cookie.name, cookie.value);
              pendingCookies.set(cookie.name, cookie);
            }
            // The SDK sends these only on its first write. Keep them when
            // subsequent writes replace or clear another session chunk.
            for (const [name, value] of Object.entries(headers))
              responseHeaders.set(name, value);
          },
        },
      },
    );

    // Creating the client alone does not refresh its lazy session. getUser
    // validates with Auth; API actor/context still enforce roles and tenants.
    await supabase.auth.getUser();
  }

  // Forward the new cookies upstream as well as to the browser, so the route
  // does not attempt to reuse the old refresh token.
  const response = NextResponse.next({
    request: { headers: request.headers },
  });
  for (const { name, value, options } of pendingCookies.values())
    response.cookies.set(name, value, options);
  responseHeaders.forEach((value, name) => response.headers.set(name, value));
  return response;
}
