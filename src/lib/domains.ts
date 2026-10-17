import "server-only";
import { Resolver } from "node:dns/promises";
import { ApiError } from "./api";
import { safeHostname } from "./validation";

const resolver = new Resolver({ timeout: 5000, tries: 2 });
type RenderDomain = { id: string; name: string; verificationStatus: string };
type RenderConfig = {
  endpoint: string;
  apiKey: string;
  serviceHostname: string;
};

function validatedHostname(hostname: string) {
  try {
    return safeHostname(hostname);
  } catch {
    throw new ApiError(
      400,
      "Escribe un dominio público válido, sin rutas ni https.",
    );
  }
}

async function requireOwnership(hostname: string, token: string) {
  const domain = validatedHostname(hostname);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token))
    throw new ApiError(
      400,
      "El código de verificación de propiedad no es válido.",
    );
  const records = await resolver
    .resolveTxt(`_tolentino.${domain}`)
    .catch(() => []);
  if (
    !records.some(
      (parts) => parts.join("") === `tolentino-verification=${token}`,
    )
  ) {
    throw new ApiError(
      400,
      "Todavía no se encuentra el registro TXT de propiedad. Revisa el valor y espera a que se propague.",
    );
  }
  return domain;
}

function renderConfig(): RenderConfig {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = process.env.RENDER_SERVICE_ID;
  const serviceHostname = process.env.RENDER_SERVICE_HOSTNAME;
  if (!apiKey || !serviceId || !serviceHostname) {
    throw new ApiError(
      503,
      "La propiedad está comprobada. Falta configurar la conexión de Render para registrar o verificar este dominio.",
    );
  }
  let normalizedHost: string;
  try {
    normalizedHost = safeHostname(serviceHostname);
  } catch {
    throw new ApiError(
      503,
      "La dirección del servicio de Render no está configurada correctamente.",
    );
  }
  if (
    !/^srv-[a-zA-Z0-9]+$/.test(serviceId) ||
    !normalizedHost.endsWith(".onrender.com")
  ) {
    throw new ApiError(
      503,
      "Revisa el identificador y la dirección onrender.com del servicio de Render configurado.",
    );
  }
  return {
    apiKey,
    serviceHostname: normalizedHost,
    endpoint: `https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/custom-domains`,
  };
}

async function renderRequest(
  config: RenderConfig,
  query = "",
  method: "GET" | "POST" = "GET",
  name?: string,
) {
  try {
    return await fetch(`${config.endpoint}${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      ...(method === "POST" ? { body: JSON.stringify({ name }) } : {}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(
      502,
      "No pudimos conectar con Render. Reintenta la operación; ningún dominio se activó automáticamente.",
    );
  }
}

function providerError(status: number): never {
  if (status === 402)
    throw new ApiError(
      402,
      "Render solicita revisar la facturación antes de añadir este dominio. No se activó el dominio.",
    );
  if (status === 409)
    throw new ApiError(
      409,
      "Render indica que este dominio entra en conflicto con otra configuración. Revisa su registro antes de reintentar.",
    );
  if (status === 429)
    throw new ApiError(
      429,
      "Render recibió demasiadas solicitudes. Espera un momento antes de reintentar.",
    );
  throw new ApiError(
    502,
    "Render no pudo completar la operación. Revisa la conexión y los permisos del servicio.",
  );
}

function isDomain(value: unknown): value is RenderDomain {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.name === "string" &&
    typeof row.verificationStatus === "string"
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiError(
      502,
      "Render devolvió una respuesta no válida. Revisa el registro antes de reintentar.",
    );
  }
}

async function findDomain(
  config: RenderConfig,
  domain: string,
): Promise<RenderDomain | undefined> {
  const response = await renderRequest(
    config,
    `?name=${encodeURIComponent(domain)}&limit=100`,
  );
  if (!response.ok) providerError(response.status);
  const data = await readJson(response);
  if (
    !Array.isArray(data) ||
    data.some(
      (entry) =>
        !entry || typeof entry !== "object" || !isDomain(entry.customDomain),
    )
  ) {
    throw new ApiError(
      502,
      "Render devolvió una lista de dominios no válida. No se realizó ningún registro.",
    );
  }
  return data
    .map((entry) => entry.customDomain as RenderDomain)
    .find((entry) => entry.name.toLowerCase().replace(/\.$/, "") === domain);
}

export function dnsInstructions(hostname: string, token: string) {
  const domain = validatedHostname(hostname);
  const records = [
    {
      type: "TXT",
      name: `_tolentino.${domain}`,
      value: `tolentino-verification=${token}`,
    },
  ];
  if (process.env.RENDER_SERVICE_HOSTNAME)
    records.push({
      type: "CNAME",
      name: domain,
      value: safeHostname(process.env.RENDER_SERVICE_HOSTNAME),
    });
  return records;
}

/** Registration is explicit and may affect provider billing. It never authorizes public routing. */
export async function registerDomain(
  hostname: string,
  token: string,
): Promise<{
  status: "pending";
  hostname: string;
  alreadyRegistered: boolean;
  renderDomainId: string;
}> {
  const domain = await requireOwnership(hostname, token);
  const config = renderConfig();
  const existing = await findDomain(config, domain);
  const pending = (entry: RenderDomain, alreadyRegistered: boolean) => ({
    status: "pending" as const,
    hostname: domain,
    alreadyRegistered,
    renderDomainId: entry.id,
  });
  if (existing) return pending(existing, true);

  const response = await renderRequest(config, "", "POST", domain);
  // Another request may have added the same domain after the first read.
  if (response.status === 409) {
    const concurrent = await findDomain(config, domain);
    if (concurrent) return pending(concurrent, true);
    providerError(409);
  }
  if (!response.ok) providerError(response.status);
  const data = await readJson(response);
  const created = Array.isArray(data)
    ? data.find(
        (entry) =>
          isDomain(entry) &&
          entry.name.toLowerCase().replace(/\.$/, "") === domain,
      )
    : undefined;
  if (!isDomain(created))
    throw new ApiError(
      502,
      "Render no confirmó el dominio solicitado. Consulta su registro antes de reintentar.",
    );
  // Even if Render reports verified immediately, TXT + CNAME + a separate verification are still required.
  return pending(created, false);
}

export async function verifyDomain(hostname: string, token: string) {
  const domain = await requireOwnership(hostname, token);
  const config = renderConfig();
  const cnames = await resolver.resolveCname(domain).catch(() => []);
  if (
    !cnames.some(
      (name) =>
        name.replace(/\.$/, "").toLowerCase() === config.serviceHostname,
    )
  ) {
    throw new ApiError(
      400,
      "El CNAME no apunta al servicio de Tolentino configurado en Render.",
    );
  }
  const found = await findDomain(config, domain);
  if (!found)
    throw new ApiError(
      400,
      "Registra primero este dominio en el servicio de Render. Después vuelve a verificarlo aquí.",
    );
  if (found.verificationStatus !== "verified")
    throw new ApiError(
      400,
      "Render todavía no ha verificado el dominio. Completa su verificación y vuelve a intentarlo.",
    );
  return true;
}
