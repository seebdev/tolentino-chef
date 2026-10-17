import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => {
  const writes: string[] = [];
  const db = {
    from: vi.fn((table: string) => ({
      update: vi.fn(() => ({
        eq: vi.fn(async () => {
          writes.push(table);
          return { error: null };
        }),
      })),
    })),
  };
  return { writes, db };
});
vi.mock("@/lib/access", () => ({
  context: async () => ({
    db: fixture.db,
    user: { id: "owner" },
    restaurant: { name: "Demo", description: "" },
    role: "owner",
  }),
  audit: vi.fn(),
  sensitive: vi.fn(),
}));
vi.mock("@/lib/config", () => ({
  configured: () => true,
  appUrl: () => "http://localhost:3000",
  platformHosts: () => new Set(["localhost"]),
}));
vi.mock("@/lib/supabase", () => ({ serviceDb: () => fixture.db }));
vi.mock("@/lib/domains", () => ({
  dnsInstructions: vi.fn(),
  verifyDomain: vi.fn(),
  registerDomain: vi.fn(),
}));
import { POST } from "../src/app/api/workspace/[restaurantId]/route";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
async function post(action: string, data: unknown) {
  return POST(
    new Request("http://localhost:3000/api/workspace/" + id, {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ action, data }),
    }),
    { params: Promise.resolve({ restaurantId: id }) },
  );
}
beforeEach(() => {
  fixture.writes.length = 0;
  vi.clearAllMocks();
});
describe("workspace input validation before persistence", () => {
  it("rejects invalid restaurant name before saving appearance draft", async () => {
    const response = await post("save_appearance", {
      name: "x",
      description: "",
      appearance: { primary: "#751D2C", secondary: "#FFF4DF", font: "serif" },
    });
    expect(response.status).toBe(400);
    expect(fixture.writes).toEqual([]);
  });
  it("reports a foreign image reference as invalid input without database writes", async () => {
    const response = await post("save_product", {
      name: "Demo",
      category_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      price: 10,
      image_path:
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp",
    });
    expect(response.status).toBe(400);
    expect(fixture.writes).toEqual([]);
  });
  it("saves valid restaurant information and appearance", async () => {
    const response = await post("save_appearance", {
      name: "Demo restaurant",
      description: "Demo only",
      appearance: { primary: "#751D2C", secondary: "#FFF4DF", font: "serif" },
    });
    expect(response.status).toBe(200);
    expect(fixture.writes).toEqual(["restaurant_settings", "restaurants"]);
  });
});
