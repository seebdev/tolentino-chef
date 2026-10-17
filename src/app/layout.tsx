import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "Tolentino · Restaurantes Admin",
    template: "%s · Tolentino",
  },
  description:
    "Un solo lugar para administrar restaurantes, menús digitales y códigos QR.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
