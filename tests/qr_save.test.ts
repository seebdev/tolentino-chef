import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ generate: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/qr", async (original) => ({
  ...(await original<typeof import("../src/lib/qr")>()),
  generateQr: mocks.generate,
}));
vi.mock("@/lib/config", () => ({
  appUrl: () => "https://canonical.example.test",
  configured: () => true,
}));
vi.mock("@/lib/supabase", () => ({ serviceDb: () => ({}) }));
import { saveQrConfiguration, permanentQrUrl } from "../src/lib/restaurant-qr";
const config = {
  foreground: "#163c2c",
  background: "#ffffff",
  label: "Menú",
  frame: "rounded",
  include_logo: false,
  config_version: 3,
  logo_size: 12,
  font_family: "serif",
  module_style: "rounded",
  export_size: 512,
};
const db = { rpc: mocks.rpc } as unknown as SupabaseClient;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.generate.mockResolvedValue(Buffer.from("validated fixture"));
  mocks.rpc.mockResolvedValue({
    data: { ...config, config_version: 4 },
    error: null,
  });
});
describe("QR save gate with mocked renderer; real raster validation covered separately", () => {
  it("validates all formats before the one atomic versioned save", async () => {
    const result = await saveQrConfiguration(
      db,
      "tenant",
      "permanent-token",
      config,
    );
    expect(mocks.generate.mock.calls.map(([x]) => x.format)).toEqual([
      "png",
      "svg",
      "pdf",
    ]);
    expect(
      mocks.generate.mock.calls.every(
        ([x]) => x.url === "https://canonical.example.test/q/permanent-token",
      ),
    ).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("save_qr_configuration", {
      p_restaurant_id: "tenant",
      p_config: config,
      p_expected_version: 3,
    });
    expect(result.config_version).toBe(4);
  });
  it("does not save any settings if final PDF validation fails", async () => {
    mocks.generate.mockImplementation(async ({ format }) => {
      if (format === "pdf") throw new Error("No se pudo decodificar");
      return Buffer.from("fixture");
    });
    await expect(
      saveQrConfiguration(db, "tenant", "token", config),
    ).rejects.toThrow(/decodificar/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects oversized logo config before composition or save", async () => {
    await expect(
      saveQrConfiguration(db, "tenant", "token", { ...config, logo_size: 40 }),
    ).rejects.toThrow();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns a conflict rather than overwriting a newer configuration", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PT409" } });
    await expect(
      saveQrConfiguration(db, "tenant", "token", config),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("canonical identity only uses server application origin and token", () => {
    expect(permanentQrUrl("permanent-token")).toBe(
      "https://canonical.example.test/q/permanent-token",
    );
  });
});
