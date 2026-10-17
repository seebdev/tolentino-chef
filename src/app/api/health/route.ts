import { configured } from "@/lib/config";
import { serviceDb } from "@/lib/supabase";
import { json } from "@/lib/api";

function projectReference() {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
    return url.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  // The project reference is public (part of NEXT_PUBLIC_SUPABASE_URL).
  // Migration runners use it to reject an application still serving the source.
  const supabaseProjectRef = projectReference();
  if (!configured())
    return json(
      { status: "setup_required", configured: false, supabaseProjectRef },
      503,
    );
  try {
    const { error } = await serviceDb()
      .from("platform_settings")
      .select("id")
      .limit(1);
    return json(
      {
        status: error ? "degraded" : "ok",
        configured: true,
        supabaseProjectRef,
      },
      error ? 503 : 200,
    );
  } catch {
    return json(
      { status: "degraded", configured: true, supabaseProjectRef },
      503,
    );
  }
}
