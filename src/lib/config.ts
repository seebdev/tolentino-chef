import "server-only";
export function configured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}
export function appUrl() {
  const url = new URL(process.env.APP_URL || "http://localhost:3000");
  if (
    process.env.NODE_ENV === "production" &&
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    throw new Error("APP_URL debe usar HTTPS en producción.");
  return url.origin;
}
export function platformHosts() {
  return new Set([
    new URL(appUrl()).hostname,
    ...(process.env.PLATFORM_HOSTNAMES || "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  ]);
}
