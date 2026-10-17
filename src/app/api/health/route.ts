import { configured } from "@/lib/config";
import { serviceDb } from "@/lib/supabase";
import { json } from "@/lib/api";
export async function GET() {
  if (!configured())
    return json({ status: "setup_required", configured: false }, 503);
  try {
    const { error } = await serviceDb()
      .from("platform_settings")
      .select("id")
      .limit(1);
    return json(
      { status: error ? "degraded" : "ok", configured: true },
      error ? 503 : 200,
    );
  } catch {
    return json({ status: "degraded", configured: true }, 503);
  }
}
