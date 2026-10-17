import { NextRequest, NextResponse } from "next/server";
import { configured, platformHosts } from "@/lib/config";
import { serviceDb } from "@/lib/supabase";
import { refreshSession, usesSession } from "@/lib/session-refresh";
export async function proxy(request: NextRequest) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  if (request.nextUrl.pathname === "/api/health") return NextResponse.next();
  if (platformHosts().has(host))
    return usesSession(request.nextUrl.pathname)
      ? refreshSession(request)
      : NextResponse.next();
  if (!configured())
    return new NextResponse("Dominio no configurado", { status: 421 });
  const db = serviceDb();
  const domain = await db
    .from("restaurant_domains")
    .select("restaurant_id")
    .eq("hostname", host)
    .eq("status", "verified")
    .maybeSingle();
  if (!domain.data)
    return new NextResponse("Dominio no configurado", { status: 421 });
  const restaurant = await db
    .from("restaurants")
    .select("slug")
    .eq("id", domain.data.restaurant_id)
    .single();
  if (!restaurant.data)
    return new NextResponse("Menú no disponible", { status: 404 });
  const pathname = request.nextUrl.pathname;
  if (pathname === "/") {
    const target = request.nextUrl.clone();
    target.pathname = `/menu/${restaurant.data.slug}`;
    return NextResponse.rewrite(target);
  }
  if (
    pathname.startsWith("/_next/") ||
    pathname === `/menu/${restaurant.data.slug}` ||
    pathname === `/api/public/menu/${restaurant.data.slug}` ||
    pathname.startsWith(`/api/media/${domain.data.restaurant_id}/`)
  )
    return NextResponse.next();
  return new NextResponse("Ruta no disponible en este dominio", {
    status: 404,
  });
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
