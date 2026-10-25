import { it, expect } from "vitest";
import { hasPendingMenuTranslation } from "../src/lib/menu-translations";
import { auditData } from "./e2e/audit-fixtures";
const data = () => ({ ...auditData(), contact: null });
it("source language is not pending", () =>
  expect(hasPendingMenuTranslation(data(), "es")).toBe(false));
it("missing category translation is pending even with no products", () => {
  const d = data();
  d.restaurant.description = "";
  d.products = [];
  expect(hasPendingMenuTranslation(d, "en")).toBe(true);
});
it("missing extra text stays pending after title and description are translated", () => {
  const d = data();
  d.restaurant.description = "";
  d.categories = [];
  d.products = [
    {
      ...d.products[0],
      ingredients: "",
      tags: [],
      variants: [],
      extras: [{ name: "Queso", price: 1 }],
    },
  ];
  d.translations = [
    {
      entity_type: "product",
      entity_id: d.products[0].id,
      language: "en",
      fields: { name: "Pizza", description: "Basil pizza" },
    },
  ];
  expect(hasPendingMenuTranslation(d, "en")).toBe(true);
  d.translations[0].fields.extras = [{ name: "Cheese" }];
  expect(hasPendingMenuTranslation(d, "en")).toBe(false);
});
it("promotions and restaurant description require their own translation", () => {
  const d = data();
  d.products = [];
  d.categories = [];
  d.promotions = [
    {
      id: "p",
      title: "Oferta",
      description: "Hoy",
      is_active: true,
      starts_at: null,
      ends_at: null,
    },
  ];
  d.translations = [
    {
      entity_type: "restaurant",
      entity_id: d.restaurant.id,
      language: "en",
      fields: { description: "Restaurant" },
    },
    {
      entity_type: "promotion",
      entity_id: "p",
      language: "en",
      fields: { title: "Offer", description: "Today" },
    },
  ];
  expect(hasPendingMenuTranslation(d, "en")).toBe(false);
  d.translations[1].fields.description = "";
  expect(hasPendingMenuTranslation(d, "en")).toBe(true);
});
