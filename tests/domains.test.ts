import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// DNS and HTTP are mocked: these tests never register a real domain or use real credentials.
const mocks = vi.hoisted(() => ({
  txt: vi.fn<(hostname: string) => Promise<string[][]>>(),
  cname: vi.fn<(hostname: string) => Promise<string[]>>(),
  fetch: vi.fn<typeof fetch>(),
}));
vi.mock("node:dns/promises", () => ({
  Resolver: class {
    resolveTxt = mocks.txt;
    resolveCname = mocks.cname;
  },
}));

import { registerDomain, verifyDomain } from "../src/lib/domains";

const domain = "menu.restaurant.com";
const token = "4bd972ac-3fca-4b78-a57d-b26d760f331e";
const endpoint =
  "https://api.render.com/v1/services/srv-test123/custom-domains";
const remote = (verificationStatus = "unverified", name = domain) => ({
  id: "cdm-test123",
  name,
  verificationStatus,
});
const listed = (verificationStatus = "unverified", name = domain) =>
  Response.json([
    { customDomain: remote(verificationStatus, name), cursor: "cursor-test" },
  ]);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("RENDER_API_KEY", "synthetic-test-key");
  vi.stubEnv("RENDER_SERVICE_ID", "srv-test123");
  vi.stubEnv("RENDER_SERVICE_HOSTNAME", "tolentino.onrender.com");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.txt.mockResolvedValue([["tolentino-verification=", token]]);
  mocks.cname.mockResolvedValue(["tolentino.onrender.com."]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Render registration with mocked DNS and HTTP", () => {
  it("checks ownership before reading Render and adds only the named domain to the configured service", async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json([remote()], { status: 201 }));
    const result = await registerDomain(" Menu.Restaurant.Com. ", token);
    expect(result).toEqual({
      status: "pending",
      hostname: domain,
      alreadyRegistered: false,
      renderDomainId: "cdm-test123",
    });
    expect(mocks.txt).toHaveBeenCalledWith(`_tolentino.${domain}`);
    expect(mocks.txt.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.fetch.mock.invocationCallOrder[0],
    );
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      1,
      `${endpoint}?name=${domain}&limit=100`,
      expect.objectContaining({ method: "GET", redirect: "error" }),
    );
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      2,
      endpoint,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: domain }),
        redirect: "error",
        cache: "no-store",
      }),
    );
    expect(mocks.cname).not.toHaveBeenCalled();
    for (const [url, options] of mocks.fetch.mock.calls) {
      expect(new URL(String(url)).origin).toBe("https://api.render.com");
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      expect(new Headers(options?.headers).get("authorization")).toBe(
        "Bearer synthetic-test-key",
      );
    }
  });

  it("does not create an already registered domain or promote it to locally verified", async () => {
    mocks.fetch.mockResolvedValue(listed("verified"));
    expect(await registerDomain(domain, token)).toMatchObject({
      status: "pending",
      alreadyRegistered: true,
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.fetch.mock.calls[0][1]?.method).toBe("GET");
  });

  it("never activates a newly added domain even if the provider POST says verified", async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json([remote("verified")], { status: 201 }),
      );
    expect(await registerDomain(domain, token)).toMatchObject({
      status: "pending",
      alreadyRegistered: false,
    });
  });

  it("handles a concurrent registration idempotently by rereading a 409 conflict", async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json({ message: "conflict" }, { status: 409 }),
      )
      .mockResolvedValueOnce(listed());
    expect(await registerDomain(domain, token)).toMatchObject({
      status: "pending",
      alreadyRegistered: true,
    });
    expect(
      mocks.fetch.mock.calls.map(([, options]) => options?.method),
    ).toEqual(["GET", "POST", "GET"]);
  });

  it("fails closed when a 409 belongs elsewhere rather than this service", async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json({ message: "conflict" }, { status: 409 }),
      )
      .mockResolvedValueOnce(Response.json([]));
    await expect(registerDomain(domain, token)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("refuses unproven or wrong ownership without contacting Render", async () => {
    for (const txt of [
      [],
      [["tolentino-verification=wrong-owner-token"]],
      [[`tolentino-verification=${token}-extra`]],
    ]) {
      mocks.txt.mockResolvedValueOnce(txt);
      await expect(registerDomain(domain, token)).rejects.toMatchObject({
        status: 400,
      });
    }
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects non-hostnames, local addresses and malformed proof tokens before DNS or HTTP", async () => {
    for (const hostname of [
      "https://attacker.com/path",
      "127.0.0.1",
      "localhost",
      "restaurant.internal",
      "menu.restaurant.com@attacker.com",
      "menu.restaurant.com/../../service",
    ]) {
      await expect(registerDomain(hostname, token)).rejects.toMatchObject({
        status: 400,
      });
    }
    await expect(registerDomain(domain, "")).rejects.toMatchObject({
      status: 400,
    });
    expect(mocks.txt).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("requires complete, fixed Render service configuration after proving ownership", async () => {
    vi.stubEnv("RENDER_API_KEY", "");
    await expect(registerDomain(domain, token)).rejects.toMatchObject({
      status: 503,
    });
    vi.stubEnv("RENDER_API_KEY", "synthetic-test-key");
    vi.stubEnv("RENDER_SERVICE_ID", "../../services/another-service");
    await expect(registerDomain(domain, token)).rejects.toMatchObject({
      status: 503,
    });
    vi.stubEnv("RENDER_SERVICE_ID", "srv-test123");
    vi.stubEnv("RENDER_SERVICE_HOSTNAME", "attacker.com");
    await expect(registerDomain(domain, token)).rejects.toMatchObject({
      status: 503,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("sanitizes provider, billing and network errors without leaking response details", async () => {
    const privateDetail = "provider-private-detail-synthetic";
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ message: privateDetail }, { status: 401 }),
    );
    await expect(registerDomain(domain, token)).rejects.toMatchObject({
      status: 502,
    });
    mocks.fetch
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json({ message: privateDetail }, { status: 402 }),
      );
    const billing = await registerDomain(domain, token).catch((error) => error);
    expect(billing).toMatchObject({ status: 402 });
    expect(billing.message).not.toContain(privateDetail);
    expect(billing.message).toContain("facturación");
    mocks.fetch.mockRejectedValueOnce(new Error(privateDetail));
    const network = await registerDomain(domain, token).catch((error) => error);
    expect(network).toMatchObject({ status: 502 });
    expect(network.message).not.toContain(privateDetail);
  });

  it("rejects HTTP redirects and malformed provider data without following another host", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.com" },
      }),
    );
    await expect(registerDomain(domain, token)).rejects.toMatchObject({
      status: 502,
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    mocks.fetch.mockResolvedValueOnce(Response.json({ unexpected: true }));
    await expect(registerDomain(domain, token)).rejects.toMatchObject({
      status: 502,
    });
    mocks.fetch
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json([remote("verified", "different.restaurant.com")], {
          status: 201,
        }),
      );
    await expect(registerDomain(domain, token)).rejects.toMatchObject({
      status: 502,
    });
  });
});

describe("separate domain activation checks", () => {
  it("requires TXT, the configured CNAME and Render verified state before returning true", async () => {
    mocks.fetch.mockResolvedValueOnce(listed("verified"));
    await expect(verifyDomain(domain, token)).resolves.toBe(true);
    expect(mocks.cname).toHaveBeenCalledWith(domain);
    expect(
      mocks.fetch.mock.calls.every(([, options]) => options?.method === "GET"),
    ).toBe(true);
  });

  it("refuses a wrong CNAME or an unverified provider domain", async () => {
    mocks.cname.mockResolvedValueOnce(["other.onrender.com"]);
    await expect(verifyDomain(domain, token)).rejects.toMatchObject({
      status: 400,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.fetch.mockResolvedValueOnce(listed("unverified"));
    await expect(verifyDomain(domain, token)).rejects.toMatchObject({
      status: 400,
    });
  });
});
