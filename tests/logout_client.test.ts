import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/components/ui";
import {
  hasConfirmedLocalLogout,
  LOCAL_LOGOUT_WARNING,
} from "../src/lib/session-messages";
import LoginPage from "../src/app/login/page";
afterEach(() => vi.unstubAllGlobals());
describe("logout client handling", () => {
  it("propagates a confirmed local cleanup and recognizes only the fixed 503 outcome", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: LOCAL_LOGOUT_WARNING,
            code: "AUTH_REVOCATION_UNCONFIRMED",
            localSessionCleared: true,
          },
          { status: 503 },
        ),
      ),
    );
    let error: unknown;
    try {
      await api("/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: "logout" }),
      });
    } catch (e) {
      error = e;
    }
    expect(hasConfirmedLocalLogout(error)).toBe(true);
    expect((error as Error).message).toBe(LOCAL_LOGOUT_WARNING);
    expect(
      hasConfirmedLocalLogout(
        Object.assign(new Error("unconfirmed"), {
          status: 503,
          code: "OTHER",
          localSessionCleared: true,
        }),
      ),
    ).toBe(false);
  });
  it("does not turn an ordinary HTTP or network error into a successful local logout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "Unavailable" }, { status: 503 }),
      ),
    );
    await expect(api("/api/auth")).rejects.toSatisfy(
      (e: unknown) => !hasConfirmedLocalLogout(e),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("private-network-detail");
      }),
    );
    await expect(api("/api/auth")).rejects.toSatisfy(
      (e: unknown) =>
        !hasConfirmedLocalLogout(e) &&
        !(e as Error).message.includes("private-network-detail"),
    );
  });
  it("renders only the fixed logout warning from the login query parameter", async () => {
    const page = await LoginPage({
      searchParams: Promise.resolve({ logout: "unconfirmed" }),
    });
    expect(page.props.initialError).toBe(LOCAL_LOGOUT_WARNING);
    const unrelated = await LoginPage({
      searchParams: Promise.resolve({ logout: "untrusted-message" }),
    });
    expect(unrelated.props.initialError).toBe("");
  });
});
