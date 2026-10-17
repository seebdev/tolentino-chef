import { Login } from "@/components/login";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  return (
    <Login
      initialMode={
        p.mode === "password" || p.recovery === "1" ? "password" : "login"
      }
      initialError={
        p.error
          ? "El enlace de acceso no es válido o ha caducado. Solicita uno nuevo."
          : ""
      }
    />
  );
}
