export const LOCAL_LOGOUT_WARNING =
  "Cerramos la sesión en este navegador, pero no pudimos confirmar su revocación en el servidor. Vuelve a iniciar sesión para continuar.";

export function hasConfirmedLocalLogout(error: unknown): boolean {
  return (
    error instanceof Error &&
    "localSessionCleared" in error &&
    error.localSessionCleared === true &&
    "code" in error &&
    error.code === "AUTH_REVOCATION_UNCONFIRMED" &&
    "status" in error &&
    error.status === 503
  );
}
