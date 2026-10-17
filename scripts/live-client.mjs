export const base = process.env.AUDIT_BASE_URL || "http://localhost:3000";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export class Session {
  constructor() {
    this.jar = new Map();
  }
  async request(
    path,
    { method = "GET", data, form, expected = [200, 201], retry = 0 } = {},
  ) {
    const headers = {
      origin: base,
      cookie: [...this.jar].map(([k, v]) => k + "=" + v).join("; "),
    };
    if (data) headers["content-type"] = "application/json";
    const r = await fetch(base + path, {
      method,
      headers,
      body: form || (data ? JSON.stringify(data) : undefined),
      signal: AbortSignal.timeout(90000),
      redirect: "manual",
    });
    for (const raw of r.headers.getSetCookie()) {
      const p = raw.split(";")[0],
        i = p.indexOf("=");
      this.jar.set(p.slice(0, i), p.slice(i + 1));
    }
    if (r.status === 429 && retry < 2) {
      console.log("Rate limit: waiting for the next permitted window");
      await wait(61000);
      return this.request(path, {
        method,
        data,
        form,
        expected,
        retry: retry + 1,
      });
    }
    const type = r.headers.get("content-type") || "";
    const value = type.includes("json")
      ? await r.json()
      : Buffer.from(await r.arrayBuffer());
    if (!expected.includes(r.status))
      throw Error(path + " HTTP " + r.status + " " + (value.error || ""));
    return { status: r.status, data: value, headers: r.headers };
  }
  async login(email, password) {
    const r = await this.request("/api/auth", {
      method: "POST",
      data: { action: "login", email, password },
    });
    return r.data;
  }
  async logout() {
    await this.request("/api/auth", {
      method: "POST",
      data: { action: "logout" },
    });
  }
}
