import "server-only";
import type { serviceDb } from "./supabase";
import { dbError } from "./api";
// Every caller supplies an already-authorized database client and an explicit restaurant.
export async function allRows(
  db: ReturnType<typeof serviceDb>,
  table: string,
  restaurantId: string,
  columns = "*",
) {
  const data: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await db
      .from(table)
      .select(columns)
      .eq("restaurant_id", restaurantId)
      .order("id")
      .range(offset, offset + 999);
    dbError(result.error);
    const batch = result.data as unknown as Record<string, unknown>[];
    data.push(...batch);
    if (batch.length < 1000) break;
  }
  return { data, error: null };
}
