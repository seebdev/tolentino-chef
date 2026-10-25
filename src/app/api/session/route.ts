import { actor, context } from "@/lib/access";
import { json, route } from "@/lib/api";
export async function GET() {
  return route(async () => {
    const current = await actor({ allowPasswordChange: true });
    if (current.role === "owner" && !current.requiresPasswordChange)
      await context(current.membership!.restaurant_id);
    return json({
      user: { id: current.user.id, email: current.user.email },
      role: current.role,
      requiresPasswordChange: current.requiresPasswordChange,
      redirect: current.requiresPasswordChange ? "/login?mode=password" : undefined,
      restaurantId: current.membership?.restaurant_id || null,
    });
  });
}
