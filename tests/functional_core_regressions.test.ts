import { describe, expect, it } from "vitest";
import { productInput, appearanceInput } from "../src/lib/validation";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
describe("functional closure: omitted fields preserve existing data", () => {
  it("does not inject an empty variants array when the owner omits the removed field", () => {
    const value = productInput.parse({ id, category_id:id, name:"Original", price:24000 });
    expect(Object.hasOwn(value,"variants")).toBe(false);
  });
  it("an appearance patch does not invent values for omitted controls", () => {
    const value = appearanceInput.parse({primary:"#BB5500"});
    expect(value).toEqual({primary:"#BB5500"});
  });
  it("validates independent one/two column choices and rejects other counts", () => {
    expect(appearanceInput.parse({columns_mobile:1,columns_desktop:2})).toMatchObject({columns_mobile:1,columns_desktop:2});
    expect(appearanceInput.safeParse({columns_mobile:3}).success).toBe(false);
  });
});