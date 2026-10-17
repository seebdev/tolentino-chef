import Link from "next/link";
export default function NotFound() {
  return (
    <main className="standalone-state">
      <span className="eyebrow">404 · TOLENTINO</span>
      <h1>Esta página no está disponible.</h1>
      <p>Comprueba la dirección o vuelve al inicio.</p>
      <Link className="button" href="/">
        Volver al inicio
      </Link>
    </main>
  );
}
