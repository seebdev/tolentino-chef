import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    tables: {} as Record<string, Row[]>,
    calls: [] as {
      table: string;
      columns: string;
      filters: [string, unknown][];
    }[],
  };
  const cache = new Map<string, Promise<unknown>>();
  const context = vi.fn();
  const download = vi.fn(async () => ({
    data: new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }),
    error: null,
  }));
  function from(table: string) {
    const call = { table, columns: "*", filters: [] as [string, unknown][] };
    state.calls.push(call);
    let start = 0;
    let end = Number.MAX_SAFE_INTEGER;
    const execute = () => {
      const rows = (state.tables[table] ?? [])
        .filter((row) =>
          call.filters.every(([key, value]) => row[key] === value),
        )
        .slice(start, end + 1);
      return rows.map((row) =>
        call.columns === "*"
          ? { ...row }
          : Object.fromEntries(
              call.columns
                .split(",")
                .filter((key) => key in row)
                .map((key) => [key, row[key]]),
            ),
      );
    };
    const query = {
      select(columns: string) {
        call.columns = columns;
        return query;
      },
      eq(key: string, value: unknown) {
        call.filters.push([key, value]);
        return query;
      },
      order() {
        return query;
      },
      range(first: number, last: number) {
        start = first;
        end = last;
        return query;
      },
      limit(count: number) {
        end = count - 1;
        return query;
      },
      async single() {
        return { data: execute()[0] ?? null, error: null };
      },
      async maybeSingle() {
        return { data: execute()[0] ?? null, error: null };
      },
      then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
        resolve?:
          | ((value: {
              data: Row[];
              error: null;
            }) => TResult1 | PromiseLike<TResult1>)
          | null,
        reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return Promise.resolve({ data: execute(), error: null }).then(
          resolve,
          reject,
        );
      },
    };
    return query;
  }
  const db = {
    from: vi.fn(from),
    storage: { from: vi.fn(() => ({ download })) },
  };
  return { state, cache, context, download, db };
});

vi.mock("@/lib/supabase", () => ({ serviceDb: () => fixtures.db }));
vi.mock("@/lib/config", () => ({
  configured: () => true,
  appUrl: () => "https://admin.example.com",
}));
vi.mock("@/lib/access", () => ({ context: fixtures.context }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>, key: string[]) => () => {
    const cacheKey = key.join(":");
    if (!fixtures.cache.has(cacheKey)) fixtures.cache.set(cacheKey, fn());
    return fixtures.cache.get(cacheKey);
  },
}));

import { ApiError } from "../src/lib/api";
import { publishedMenu } from "../src/lib/public-menu";
import { GET as mediaGet } from "../src/app/api/media/[restaurantId]/[...path]/route";

const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const publicImage = `${tenant}/11111111-1111-4111-8111-111111111111.webp`;
const draftImage = `${tenant}/22222222-2222-4222-8222-222222222222.webp`;

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.cache.clear();
  fixtures.state.calls = [];
  fixtures.context.mockImplementation(async () => {
    throw new ApiError(401, "Inicia sesión.");
  });
  fixtures.state.tables = {
    restaurants: [
      {
        id: tenant,
        name: "Example Restaurant",
        slug: "example-restaurant",
        status: "active",
        menu_version: 1,
        currency: "USD",
        default_language: "en",
        owner_email: "private@example.com",
        public_token: "private-token",
        description: "",
        phone: "",
      },
    ],
    restaurant_settings: [
      {
        restaurant_id: tenant,
        appearance: { logo_path: publicImage },
        draft_appearance: { logo_path: draftImage },
        enabled_languages: ["en"],
        suspension_message: "Mensaje obsoleto del restaurante",
      },
    ],
    categories: [
      {
        id: "visible",
        restaurant_id: tenant,
        name: "Visible",
        parent_id: null,
        is_visible: true,
        sort_order: 1,
      },
      {
        id: "hidden",
        restaurant_id: tenant,
        name: "Hidden",
        parent_id: null,
        is_visible: false,
        sort_order: 2,
      },
      {
        id: "child-hidden",
        restaurant_id: tenant,
        name: "Child",
        parent_id: "hidden",
        is_visible: true,
        sort_order: 3,
      },
      {
        id: "cycle-a",
        restaurant_id: tenant,
        name: "Cycle",
        parent_id: "cycle-b",
        is_visible: true,
        sort_order: 4,
      },
      {
        id: "cycle-b",
        restaurant_id: tenant,
        name: "Cycle",
        parent_id: "cycle-a",
        is_visible: true,
        sort_order: 5,
      },
      {
        id: "other-category",
        restaurant_id: other,
        name: "Other tenant",
        parent_id: null,
        is_visible: true,
        sort_order: 1,
      },
    ],
    products: [
      {
        id: "public",
        restaurant_id: tenant,
        category_id: "visible",
        name: "Public product",
        price: 10,
        image_path: publicImage,
        is_published: true,
        is_available: true,
        sort_order: 1,
        sku: "private-sku",
      },
      {
        id: "draft",
        restaurant_id: tenant,
        category_id: "visible",
        name: "Secret draft",
        price: 10,
        image_path: draftImage,
        is_published: false,
        is_available: true,
        sort_order: 2,
      },
      {
        id: "hidden-product",
        restaurant_id: tenant,
        category_id: "hidden",
        name: "Secret category product",
        is_published: true,
        sort_order: 3,
      },
      {
        id: "child-product",
        restaurant_id: tenant,
        category_id: "child-hidden",
        name: "Secret nested product",
        is_published: true,
        sort_order: 4,
      },
      {
        id: "other-product",
        restaurant_id: other,
        category_id: "other-category",
        name: "Other tenant",
        is_published: true,
        sort_order: 1,
      },
    ],
    promotions: [
      {
        id: "active",
        restaurant_id: tenant,
        title: "Active",
        is_active: true,
        starts_at: null,
        ends_at: null,
      },
      {
        id: "expired",
        restaurant_id: tenant,
        title: "Expired",
        is_active: true,
        starts_at: null,
        ends_at: "2000-01-01T00:00:00Z",
      },
      {
        id: "future",
        restaurant_id: tenant,
        title: "Future",
        is_active: true,
        starts_at: "2999-01-01T00:00:00Z",
        ends_at: null,
      },
      {
        id: "inactive",
        restaurant_id: tenant,
        title: "Inactive",
        is_active: false,
        starts_at: null,
        ends_at: null,
      },
    ],
    restaurant_hours: [],
    translations: [
      {
        id: "t-public",
        restaurant_id: tenant,
        entity_type: "product",
        entity_id: "public",
        language: "es",
        fields: { name: "Público" },
      },
      {
        id: "t-draft",
        restaurant_id: tenant,
        entity_type: "product",
        entity_id: "draft",
        language: "es",
        fields: { name: "Borrador secreto" },
      },
      {
        id: "t-hidden",
        restaurant_id: tenant,
        entity_type: "category",
        entity_id: "hidden",
        language: "es",
        fields: { name: "Oculto" },
      },
    ],
    platform_settings: [
      {
        id: "platform",
        contact_url: "https://example.com/contact",
        contact_label: "Contact",
        suspension_message: "Temporalmente cerrado",
      },
    ],
  };
});

describe("public menu data boundaries", () => {
  it("exposes only published content under visible ancestors, current promotions and related translations", async () => {
    const result = await publishedMenu("example-restaurant");
    expect("suspended" in result).toBe(false);
    if ("suspended" in result) throw new Error("Unexpected suspension");
    expect(result.products.map((product) => product.id)).toEqual(["public"]);
    expect(result.categories.map((category) => category.id)).toEqual([
      "visible",
    ]);
    expect(result.promotions.map((promotion) => promotion.id)).toEqual([
      "active",
    ]);
    expect(result.translations.map((translation) => translation.id)).toEqual([
      "t-public",
    ]);
    const serialized = JSON.stringify(result);
    for (const privateValue of [
      "private@example.com",
      "private-token",
      "private-sku",
      "Secret draft",
      "Borrador secreto",
      "Other tenant",
      draftImage,
    ])
      expect(serialized).not.toContain(privateValue);
    for (const call of fixtures.state.calls.filter((call) =>
      [
        "categories",
        "products",
        "promotions",
        "translations",
        "restaurant_hours",
        "restaurant_settings",
      ].includes(call.table),
    )) {
      expect(call.filters).toContainEqual(["restaurant_id", tenant]);
    }
  });

  it("enforces suspension immediately even when an active menu is cached", async () => {
    const active = await publishedMenu("example-restaurant");
    expect("suspended" in active).toBe(false);
    expect(fixtures.cache.size).toBe(1);
    fixtures.state.tables.restaurants[0].status = "suspended";
    const suspended = await publishedMenu("example-restaurant");
    expect(suspended).toEqual({
      suspended: true,
      name: "Example Restaurant",
      message: "Temporalmente cerrado",
    });
    expect(JSON.stringify(suspended)).not.toContain("Public product");
  });

  it("uses the publication version to invalidate cached menu content", async () => {
    await publishedMenu("example-restaurant");
    fixtures.state.tables.products[0].name = "Revised product";
    const sameVersion = await publishedMenu("example-restaurant");
    if ("suspended" in sameVersion) throw new Error("Unexpected suspension");
    expect(sameVersion.products[0].name).toBe("Public product");
    fixtures.state.tables.restaurants[0].menu_version = 2;
    const newVersion = await publishedMenu("example-restaurant");
    if ("suspended" in newVersion) throw new Error("Unexpected suspension");
    expect(newVersion.products[0].name).toBe("Revised product");
  });
});

async function getMedia(path: string, restaurantId = tenant) {
  return mediaGet(new Request("https://admin.example.com/api/media/file"), {
    params: Promise.resolve({ restaurantId, path: path.split("/") }),
  });
}

describe("public and private image authorization", () => {
  it("serves a referenced public image without authentication and disables sniffing/cache", async () => {
    const response = await getMedia(publicImage);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(fixtures.context).not.toHaveBeenCalled();
    expect(fixtures.download).toHaveBeenCalledWith(publicImage);
  });

  it("denies anonymous access to a draft or unreferenced media path before storage download", async () => {
    const response = await getMedia(draftImage);
    expect(response.status).toBe(401);
    expect(fixtures.context).toHaveBeenCalledWith(tenant);
    expect(fixtures.download).not.toHaveBeenCalled();
  });

  it("denies another tenant and permits the authorized owner to preview drafts", async () => {
    fixtures.context.mockImplementation(async () => {
      throw new ApiError(403, "No tienes acceso.");
    });
    expect((await getMedia(draftImage)).status).toBe(403);
    expect(fixtures.download).not.toHaveBeenCalled();
    fixtures.context.mockResolvedValue({ restaurantId: tenant });
    expect((await getMedia(draftImage)).status).toBe(200);
    expect(fixtures.download).toHaveBeenCalledWith(draftImage);
  });

  it("stops public image serving when the restaurant is suspended", async () => {
    await getMedia(publicImage);
    fixtures.download.mockClear();
    fixtures.state.tables.restaurants[0].status = "suspended";
    expect((await getMedia(publicImage)).status).toBe(401);
    expect(fixtures.download).not.toHaveBeenCalled();
  });

  it("rejects path traversal, foreign tenant prefixes and unsupported formats", async () => {
    for (const path of [
      "../secret.env",
      `${other}/11111111-1111-4111-8111-111111111111.webp`,
      `${tenant}/11111111-1111-4111-8111-111111111111.svg`,
    ]) {
      expect((await getMedia(path)).status).toBe(400);
    }
    expect(fixtures.download).not.toHaveBeenCalled();
  });
});
