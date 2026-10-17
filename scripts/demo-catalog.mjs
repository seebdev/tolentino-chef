// Original fictional demonstration catalogue. No customer data or external images.
export const demos = [
  {
    key: "aurora",
    name: "Pizzería Aurora · DEMO",
    slug: "pizzeria-aurora-demo",
    email: "aurora@tolentino-demo.test",
    owner: "Propietario Aurora DEMO",
    primary: "#751D2C",
    secondary: "#FFF4DF",
    accent: "#B89248",
    font: "serif",
    description:
      "DEMO · Una mesa italiana: masa de fermentación lenta, recetas de temporada y el placer de compartir.",
    kind: "pizza",
    categories: [
      [
        "Pizzas",
        "Pizzas clásicas",
        [
          "Margherita al forno",
          32000,
          "Pomodoro, mozzarella fresca y albahaca.",
        ],
        ["Diavola", 39000, "Salami picante, mozzarella y miel de ají."],
        [
          "Funghi e tartufo",
          42000,
          "Setas asadas, crema de trufa y parmesano.",
        ],
        [
          "Quattro formaggi",
          41000,
          "Mozzarella, gorgonzola, provolone y parmesano.",
        ],
      ],
      [
        "Pastas",
        "Pastas artesanales",
        [
          "Tagliatelle al ragù",
          36000,
          "Pasta artesanal con ragú de cocción lenta.",
        ],
        ["Penne primavera", 31000, "Verduras asadas y salsa de tomate."],
        [
          "Ravioli ricotta",
          38000,
          "Ricotta y espinaca, mantequilla de salvia.",
        ],
        ["Spaghetti al pesto", 33000, "Pesto de albahaca, nueces y parmesano."],
      ],
      [
        "Entradas",
        null,
        [
          "Bruschetta pomodoro",
          17000,
          "Pan tostado, tomate fresco y albahaca.",
        ],
        [
          "Burrata de temporada",
          26000,
          "Burrata cremosa, tomates y aceite de oliva.",
        ],
        ["Arancini de hongos", 22000, "Croquetas de arroz, setas y alioli."],
        ["Focaccia al romero", 14000, "Pan horneado con romero y sal marina."],
      ],
      [
        "Bebidas",
        null,
        [
          "Limonada de albahaca",
          11000,
          "Limón fresco, albahaca y agua con gas.",
        ],
        ["Aranciata", 10000, "Refresco artesanal de naranja."],
        ["Té frío de durazno", 9000, "Infusión de té negro y durazno."],
        ["Espresso italiano", 6500, "Café de origen, extracción corta."],
      ],
      [
        "Postres",
        null,
        ["Tiramisú Aurora", 18000, "Bizcocho al café, mascarpone y cacao."],
        ["Panna cotta", 16000, "Crema de vainilla con frutos rojos."],
        ["Gelato de pistacho", 15000, "Helado artesanal y pistacho tostado."],
        ["Cannoli siciliano", 14000, "Masa crujiente, ricotta y chocolate."],
      ],
      [
        "Combos",
        null,
        ["Mesa para dos", 78000, "Pizza clásica, dos bebidas y tiramisú."],
        ["Pranzo italiano", 45000, "Pasta del día, focaccia y limonada."],
        ["Noche Aurora", 105000, "Dos pizzas clásicas y cuatro bebidas."],
        ["Piccolo menú", 29000, "Pasta pequeña, bebida y helado."],
      ],
    ],
    variants: [
      { name: "Personal · 22 cm", price: 0 },
      { name: "Grande · 32 cm", price: 12000 },
    ],
    extras: [
      { name: "Mozzarella adicional", price: 5000 },
      { name: "Champiñones", price: 4000 },
      { name: "Albahaca fresca", price: 1500 },
    ],
    promo: "Atardecer italiano · DEMO",
    promoDescription:
      "De lunes a jueves, comparte nuestro combo Mesa para dos. Consulta ingredientes y disponibilidad en el menú.",
  },
  {
    key: "bruma",
    name: "Café Bruma · DEMO",
    slug: "cafe-bruma-demo",
    email: "bruma@tolentino-demo.test",
    owner: "Propietario Bruma DEMO",
    primary: "#414B2B",
    secondary: "#F3EBDD",
    accent: "#927354",
    font: "sans",
    description:
      "DEMO · Café de origen, repostería de horno y una pausa tranquila. Un espacio para disfrutar los pequeños rituales.",
    kind: "coffee",
    categories: [
      [
        "Cafés calientes",
        "Métodos de origen",
        [
          "Espresso de origen",
          6500,
          "Notas de panela, cacao y frutos amarillos.",
        ],
        ["Cappuccino Bruma", 10500, "Espresso doble y leche texturizada."],
        ["Latte de vainilla", 12000, "Café, leche y vainilla natural."],
        [
          "Filtrado V60",
          13500,
          "Extracción manual de nuestro origen invitado.",
        ],
      ],
      [
        "Cafés fríos",
        "Cold brew",
        ["Cold brew clásico", 12000, "Extracción en frío durante 18 horas."],
        ["Iced latte", 12500, "Espresso, leche fría y hielo."],
        ["Tónica espresso", 14000, "Café, tónica y piel de naranja."],
        ["Frappé de cacao", 15500, "Café helado, cacao y crema suave."],
      ],
      [
        "Panadería",
        null,
        [
          "Croissant de mantequilla",
          8500,
          "Hojaldre de mantequilla, horneado cada mañana.",
        ],
        ["Roll de canela", 10000, "Masa suave, canela y glaseado."],
        ["Pan de chocolate", 9500, "Hojaldre relleno de chocolate oscuro."],
        ["Scone de arándanos", 9000, "Masa tierna con arándanos y limón."],
      ],
      [
        "Desayunos",
        null,
        ["Tostada de aguacate", 23000, "Pan de masa madre, aguacate y tomate."],
        ["Huevos de la casa", 25000, "Huevos, tostadas y vegetales frescos."],
        ["Bowl de granola", 19000, "Yogur, fruta de temporada y granola."],
        ["Pancakes de avena", 22000, "Pancakes, frutos rojos y miel."],
      ],
      [
        "Postres",
        null,
        [
          "Cheesecake de frutos rojos",
          17000,
          "Queso cremoso y compota de frutos rojos.",
        ],
        ["Torta de zanahoria", 15000, "Especias suaves y cobertura de queso."],
        ["Brownie de cacao", 12000, "Chocolate oscuro y nueces tostadas."],
        ["Galleta de avena", 7000, "Avena, chocolate y un toque de sal."],
      ],
      [
        "Bebidas especiales",
        null,
        ["Matcha latte", 14000, "Té verde matcha y leche cremosa."],
        ["Chai especiado", 13500, "Té negro, canela, cardamomo y jengibre."],
        ["Chocolate de origen", 12000, "Cacao colombiano y leche caliente."],
        [
          "Infusión del jardín",
          9500,
          "Hierbabuena, flor de jamaica y cítricos.",
        ],
      ],
    ],
    variants: [
      { name: "Taza · 240 ml", price: 0 },
      { name: "Grande · 360 ml", price: 3000 },
    ],
    extras: [
      { name: "Leche de avena", price: 2500 },
      { name: "Leche de almendras", price: 3000 },
      { name: "Shot de espresso", price: 3500 },
    ],
    promo: "Mañanas con calma · DEMO",
    promoDescription:
      "Descubre nuestro desayuno de la casa junto al café de origen. Productos y precios de demostración.",
  },
  {
    key: "marea",
    name: "Bento Marea · DEMO",
    slug: "bento-marea-demo",
    email: "marea@tolentino-demo.test",
    owner: "Propietario Marea DEMO",
    primary: "#171B20",
    secondary: "#FFF8F5",
    accent: "#C22936",
    font: "rounded",
    description:
      "DEMO · Sabores de Asia, detalles contemporáneos. Sushi, caldos profundos y bowls preparados para compartir.",
    kind: "bowl",
    categories: [
      [
        "Sushi",
        "Rolls de autor",
        ["Roll Marea", 36000, "Salmón, aguacate, pepino y sésamo."],
        ["California roll", 29000, "Palmito de cangrejo, pepino y aguacate."],
        ["Veggie garden roll", 27000, "Vegetales frescos, mango y sésamo."],
        [
          "Nigiri selección",
          42000,
          "Seis piezas de nuestra selección del día.",
        ],
      ],
      [
        "Ramen",
        "Caldos de la casa",
        ["Shoyu ramen", 37000, "Caldo de soya, fideos, huevo y vegetales."],
        ["Miso ramen", 39000, "Caldo de miso, hongos y maíz."],
        ["Tantan ramen", 41000, "Caldo de sésamo, carne y aceite picante."],
        ["Ramen vegetal", 35000, "Caldo vegetal, tofu y setas."],
      ],
      [
        "Arroces",
        null,
        [
          "Yakimeshi de pollo",
          29000,
          "Arroz salteado, pollo, huevo y vegetales.",
        ],
        ["Bowl teriyaki", 33000, "Pollo teriyaki, arroz y verduras."],
        ["Arroz de hongos", 28000, "Arroz al wok y mezcla de hongos."],
        ["Bento salmón", 45000, "Salmón, arroz, ensalada y encurtidos."],
      ],
      [
        "Entradas",
        null,
        ["Gyozas de cerdo", 22000, "Seis dumplings dorados con salsa de soya."],
        ["Edamame al sésamo", 15000, "Vainas al vapor con sal y sésamo."],
        [
          "Tempura de vegetales",
          23000,
          "Vegetales crujientes y salsa tentsuyu.",
        ],
        ["Ensalada wakame", 17000, "Algas, pepino, sésamo y vinagre de arroz."],
      ],
      [
        "Bebidas",
        null,
        [
          "Té verde jazmín",
          9000,
          "Infusión floral, disponible fría o caliente.",
        ],
        ["Limonada de yuzu", 12500, "Cítricos y un toque de yuzu."],
        ["Soda de lichi", 12000, "Lichi, agua con gas y limón."],
        ["Té frío de mango", 11000, "Té de jazmín y mango."],
      ],
      [
        "Postres",
        null,
        ["Mochi selección", 18000, "Tres mochis de sabores variados."],
        ["Cheesecake japonés", 17000, "Bizcocho de queso ligero y aireado."],
        ["Helado de matcha", 14000, "Helado de té verde y sésamo."],
        [
          "Dorayaki de chocolate",
          15000,
          "Pancakes japoneses rellenos de chocolate.",
        ],
      ],
    ],
    variants: [
      { name: "Porción clásica", price: 0 },
      { name: "Porción para compartir", price: 14000 },
    ],
    extras: [
      { name: "Aguacate", price: 4000 },
      { name: "Huevo marinado", price: 4500 },
      { name: "Tofu", price: 5000 },
    ],
    promo: "Selección Marea · DEMO",
    promoDescription:
      "Explora los rolls de autor y acompáñalos con una limonada de yuzu. Contenido ficticio para probar la plataforma.",
  },
];
export function productData(d, categoryId, row, index) {
  return {
    category_id: categoryId,
    name: row[0],
    price: row[1],
    description: row[2] + " Producto de demostración.",
    ingredients: row[2],
    variants:
      index < 8
        ? d.variants.map((option) => ({
            ...option,
            price: row[1] + option.price,
          }))
        : [],
    extras: index < 12 ? d.extras : [],
    tags: index % 7 === 0 ? ["Selección de la casa"] : [],
    is_published: true,
    is_available: index !== 7 && index !== 19,
    is_featured: index < 4,
    sort_order: index,
    sku:
      "DEMO-" + d.key.toUpperCase() + "-" + String(index + 1).padStart(2, "0"),
  };
}
export function artwork(d, title, variant = 0, logo = false) {
  const esc = (s) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const size = logo ? 512 : 1000;
  const food =
    d.kind === "pizza"
      ? '<circle cx="500" cy="260" r="150" fill="#D6A14F"/><circle cx="500" cy="260" r="133" fill="#F4D78D"/>' +
        Array.from({ length: 8 }, (_, i) => {
          const x = 500 + 90 * Math.cos((i * Math.PI) / 4 + variant),
            y = 260 + 90 * Math.sin((i * Math.PI) / 4 + variant);
          return (
            '<circle cx="' +
            x +
            '" cy="' +
            y +
            '" r="24" fill="#A53D38"/><ellipse cx="' +
            (x + 20) +
            '" cy="' +
            (y - 12) +
            '" rx="10" ry="24" fill="#4D6B3C" transform="rotate(25 ' +
            (x + 20) +
            " " +
            (y - 12) +
            ')"/>'
          );
        }).join("")
      : d.kind === "coffee"
        ? '<ellipse cx="500" cy="355" rx="175" ry="35" fill="#D6C4A3"/><path d="M370 180h245v95c0 105-245 105-245 0z" fill="#FBF8EF"/><path d="M615 205c100-15 100 100 0 85" fill="none" stroke="#FBF8EF" stroke-width="25"/><ellipse cx="493" cy="180" rx="122" ry="40" fill="#5B3925"/><path d="M493 200c-80-65-70-70 0-25 70-45 80-40 0 25" fill="#EDDBC1"/><path d="M450 80q-25 30 0 60m55-75q-25 30 0 60m55-45q-25 30 0 60" stroke="#C8BCA5" fill="none" stroke-width="7"/>'
        : '<ellipse cx="500" cy="225" rx="180" ry="72" fill="#333C40"/><path d="M320 225q20 175 180 175t180-175" fill="#252B30"/><ellipse cx="500" cy="225" rx="160" ry="58" fill="#D9AD73"/><path d="M370 225q45-55 90 0t90 0t80 0M380 245q45-55 90 0t90 0t60 0" fill="none" stroke="#F4D395" stroke-width="12"/><ellipse cx="450" cy="203" rx="34" ry="27" fill="#FFF8E6"/><circle cx="450" cy="203" r="15" fill="#E5A43B"/><path d="M530 190l50 60m-20-70l40 55" stroke="#56865B" stroke-width="13"/><path d="M600 130l180-65m-170 95l180-55" stroke="#A27449" stroke-width="10"/>';
  if (logo)
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="100" fill="' +
      d.primary +
      '"/><circle cx="256" cy="256" r="205" fill="none" stroke="' +
      d.accent +
      '" stroke-width="5"/><text x="256" y="305" text-anchor="middle" font-family="Georgia,serif" font-size="190" fill="' +
      d.secondary +
      '">' +
      d.key[0].toUpperCase() +
      '</text><text x="256" y="375" text-anchor="middle" font-family="Arial" font-size="25" letter-spacing="8" fill="' +
      d.secondary +
      '">DEMO</text></svg>'
    );
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    size +
    '" height="650" viewBox="0 0 1000 650"><rect width="1000" height="650" fill="' +
    d.secondary +
    '"/><circle cx="60" cy="45" r="180" fill="' +
    d.accent +
    '" opacity=".1"/><circle cx="970" cy="450" r="230" fill="' +
    d.primary +
    '" opacity=".07"/>' +
    food +
    '<path d="M370 475h260" stroke="' +
    d.accent +
    '" stroke-width="3"/><text x="500" y="530" text-anchor="middle" font-family="Georgia,serif" font-size="38" fill="' +
    d.primary +
    '">' +
    esc(title) +
    '</text><text x="500" y="578" text-anchor="middle" font-family="Arial" font-size="17" letter-spacing="4" fill="' +
    d.primary +
    '">ILUSTRACIÓN ORIGINAL · DEMO</text></svg>'
  );
}

// Reviewed English names and descriptions for every fictional demo item.
export const englishCatalog = {
  aurora: {
    categories: {
      Pizzas: "Pizzas",
      "Pizzas clásicas": "Classic pizzas",
      Pastas: "Pasta",
      "Pastas artesanales": "Handmade pasta",
      Entradas: "Starters",
      Bebidas: "Drinks",
      Postres: "Desserts",
      Combos: "Meal combinations",
    },
    products: [
      {
        name: "Margherita al forno",
        description:
          "Tomato sauce, fresh mozzarella and basil. Demonstration product.",
      },
      {
        name: "Diavola pizza",
        description:
          "Spicy salami, mozzarella and chili honey. Demonstration product.",
      },
      {
        name: "Mushroom and truffle pizza",
        description:
          "Roasted mushrooms, truffle cream and Parmesan. Demonstration product.",
      },
      {
        name: "Four-cheese pizza",
        description:
          "Mozzarella, Gorgonzola, provolone and Parmesan. Demonstration product.",
      },
      {
        name: "Tagliatelle with ragù",
        description:
          "Handmade pasta with slow-cooked ragù. Demonstration product.",
      },
      {
        name: "Penne primavera",
        description:
          "Roasted vegetables and tomato sauce. Demonstration product.",
      },
      {
        name: "Ricotta ravioli",
        description:
          "Ricotta and spinach with sage butter. Demonstration product.",
      },
      {
        name: "Spaghetti with pesto",
        description:
          "Basil pesto, walnuts and Parmesan. Demonstration product.",
      },
      {
        name: "Tomato bruschetta",
        description:
          "Toasted bread, fresh tomatoes and basil. Demonstration product.",
      },
      {
        name: "Seasonal burrata",
        description:
          "Creamy burrata, tomatoes and olive oil. Demonstration product.",
      },
      {
        name: "Mushroom arancini",
        description:
          "Rice croquettes with mushrooms and aioli. Demonstration product.",
      },
      {
        name: "Rosemary focaccia",
        description:
          "Oven-baked bread with rosemary and sea salt. Demonstration product.",
      },
      {
        name: "Basil lemonade",
        description:
          "Fresh lemon, basil and sparkling water. Demonstration product.",
      },
      {
        name: "Aranciata",
        description: "House-made orange soda. Demonstration product.",
      },
      {
        name: "Peach iced tea",
        description: "Black tea infused with peach. Demonstration product.",
      },
      {
        name: "Italian espresso",
        description:
          "Origin coffee served as a short espresso. Demonstration product.",
      },
      {
        name: "Aurora tiramisu",
        description:
          "Coffee-soaked sponge cake, mascarpone and cocoa. Demonstration product.",
      },
      {
        name: "Panna cotta",
        description: "Vanilla cream with red berries. Demonstration product.",
      },
      {
        name: "Pistachio gelato",
        description:
          "Artisan ice cream with toasted pistachios. Demonstration product.",
      },
      {
        name: "Sicilian cannoli",
        description:
          "Crisp pastry filled with ricotta and chocolate. Demonstration product.",
      },
      {
        name: "Table for two",
        description:
          "A classic pizza, two drinks and tiramisu. Demonstration product.",
      },
      {
        name: "Italian lunch",
        description:
          "Pasta of the day, focaccia and lemonade. Demonstration product.",
      },
      {
        name: "Aurora evening",
        description:
          "Two classic pizzas and four drinks. Demonstration product.",
      },
      {
        name: "Piccolo menu",
        description:
          "A small pasta, a drink and ice cream. Demonstration product.",
      },
    ],
  },
  bruma: {
    categories: {
      "Cafés calientes": "Hot coffee",
      "Métodos de origen": "Origin coffee and brewing methods",
      "Cafés fríos": "Iced coffee",
      "Cold brew": "Cold brew",
      Panadería: "Bakery",
      Desayunos: "Breakfast",
      Postres: "Desserts",
      "Bebidas especiales": "Specialty drinks",
    },
    products: [
      {
        name: "Origin espresso",
        description:
          "Tasting notes of panela, cocoa and yellow fruit. Demonstration product.",
      },
      {
        name: "Bruma cappuccino",
        description:
          "A double espresso with textured milk. Demonstration product.",
      },
      {
        name: "Vanilla latte",
        description: "Coffee, milk and natural vanilla. Demonstration product.",
      },
      {
        name: "V60 pour-over",
        description:
          "Hand-brewed coffee featuring our guest origin. Demonstration product.",
      },
      {
        name: "Classic cold brew",
        description:
          "Coffee steeped in cold water for 18 hours. Demonstration product.",
      },
      {
        name: "Iced latte",
        description: "Espresso, chilled milk and ice. Demonstration product.",
      },
      {
        name: "Espresso tonic",
        description:
          "Coffee, tonic water and orange peel. Demonstration product.",
      },
      {
        name: "Cocoa frappé",
        description:
          "Iced coffee, cocoa and light cream. Demonstration product.",
      },
      {
        name: "Butter croissant",
        description:
          "Buttery laminated pastry, baked each morning. Demonstration product.",
      },
      {
        name: "Cinnamon roll",
        description:
          "Soft dough with cinnamon and icing. Demonstration product.",
      },
      {
        name: "Chocolate pastry",
        description:
          "Flaky pastry filled with dark chocolate. Demonstration product.",
      },
      {
        name: "Blueberry scone",
        description:
          "A tender scone with blueberries and lemon. Demonstration product.",
      },
      {
        name: "Avocado toast",
        description:
          "Sourdough bread, avocado and tomato. Demonstration product.",
      },
      {
        name: "House eggs",
        description: "Eggs, toast and fresh vegetables. Demonstration product.",
      },
      {
        name: "Granola bowl",
        description:
          "Yogurt, seasonal fruit and granola. Demonstration product.",
      },
      {
        name: "Oat pancakes",
        description:
          "Pancakes with red berries and honey. Demonstration product.",
      },
      {
        name: "Red berry cheesecake",
        description:
          "Creamy cheesecake with red berry compote. Demonstration product.",
      },
      {
        name: "Carrot cake",
        description:
          "Gently spiced carrot cake with cream cheese frosting. Demonstration product.",
      },
      {
        name: "Cocoa brownie",
        description:
          "Dark chocolate and toasted walnuts. Demonstration product.",
      },
      {
        name: "Oat cookie",
        description:
          "Oats, chocolate and a touch of salt. Demonstration product.",
      },
      {
        name: "Matcha latte",
        description:
          "Matcha green tea with creamy milk. Demonstration product.",
      },
      {
        name: "Spiced chai",
        description:
          "Black tea with cinnamon, cardamom and ginger. Demonstration product.",
      },
      {
        name: "Origin hot chocolate",
        description: "Colombian cocoa and hot milk. Demonstration product.",
      },
      {
        name: "Garden infusion",
        description: "Mint, hibiscus and citrus. Demonstration product.",
      },
    ],
  },
  marea: {
    categories: {
      Sushi: "Sushi",
      "Rolls de autor": "Signature rolls",
      Ramen: "Ramen",
      "Caldos de la casa": "House broths",
      Arroces: "Rice dishes",
      Entradas: "Starters",
      Bebidas: "Drinks",
      Postres: "Desserts",
    },
    products: [
      {
        name: "Marea roll",
        description:
          "Salmon, avocado, cucumber and sesame. Demonstration product.",
      },
      {
        name: "California roll",
        description: "Crab stick, cucumber and avocado. Demonstration product.",
      },
      {
        name: "Veggie garden roll",
        description:
          "Fresh vegetables, mango and sesame. Demonstration product.",
      },
      {
        name: "Nigiri selection",
        description:
          "Six pieces from our selection of the day. Demonstration product.",
      },
      {
        name: "Shoyu ramen",
        description:
          "Soy sauce broth with noodles, egg and vegetables. Demonstration product.",
      },
      {
        name: "Miso ramen",
        description:
          "Miso broth with mushrooms and corn. Demonstration product.",
      },
      {
        name: "Tantan ramen",
        description:
          "Sesame broth with meat and chili oil. Demonstration product.",
      },
      {
        name: "Vegetable ramen",
        description:
          "Vegetable broth with tofu and mushrooms. Demonstration product.",
      },
      {
        name: "Chicken yakimeshi",
        description:
          "Stir-fried rice with chicken, egg and vegetables. Demonstration product.",
      },
      {
        name: "Teriyaki bowl",
        description:
          "Teriyaki chicken with rice and vegetables. Demonstration product.",
      },
      {
        name: "Mushroom rice",
        description:
          "Wok-fried rice with a mix of mushrooms. Demonstration product.",
      },
      {
        name: "Salmon bento",
        description:
          "Salmon, rice, salad and pickled vegetables. Demonstration product.",
      },
      {
        name: "Pork gyoza",
        description:
          "Six golden dumplings with soy sauce. Demonstration product.",
      },
      {
        name: "Sesame edamame",
        description:
          "Steamed edamame pods with salt and sesame. Demonstration product.",
      },
      {
        name: "Vegetable tempura",
        description:
          "Crisp vegetables with tentsuyu dipping sauce. Demonstration product.",
      },
      {
        name: "Wakame salad",
        description:
          "Seaweed, cucumber, sesame and rice vinegar. Demonstration product.",
      },
      {
        name: "Jasmine green tea",
        description:
          "A floral infusion, served hot or iced. Demonstration product.",
      },
      {
        name: "Yuzu lemonade",
        description: "Citrus with a touch of yuzu. Demonstration product.",
      },
      {
        name: "Lychee soda",
        description:
          "Lychee, sparkling water and lemon. Demonstration product.",
      },
      {
        name: "Mango iced tea",
        description: "Jasmine tea and mango. Demonstration product.",
      },
      {
        name: "Mochi selection",
        description: "Three mochi in assorted flavors. Demonstration product.",
      },
      {
        name: "Japanese cheesecake",
        description: "A light and airy cheesecake. Demonstration product.",
      },
      {
        name: "Matcha ice cream",
        description: "Green tea ice cream with sesame. Demonstration product.",
      },
      {
        name: "Chocolate dorayaki",
        description:
          "Japanese pancakes filled with chocolate. Demonstration product.",
      },
    ],
  },
};

// Covers keep the restaurant identity as accessible page text, without overlapping image labels.
export function coverArtwork(demo) {
  return artwork(demo, "")
    .replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, "")
    .replace(/<path d="M370 475h260"[^>]*\/>/, "");
}
