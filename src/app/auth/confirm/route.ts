import { sessionDb } from "@/lib/supabase";
import { appUrl } from "@/lib/config";
import { NextResponse } from "next/server";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (token && (type === "recovery" || type === "invite")) {
    const db = await sessionDb();
    const { error } = await db.auth.verifyOtp({ token_hash: token, type });
    if (!error)
      return NextResponse.redirect(`${appUrl()}/login?mode=password`, {
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
  }
  return NextResponse.redirect(`${appUrl()}/login?error=invalid_link`, {
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
