"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Heart,
  UtensilsCrossed,
  ArrowUpRight,
  Clock3,
  ChevronDown,
  Star,
} from "lucide-react";
import { copy, languages } from "@/lib/i18n";
import {
  mediaUrl,
  money,
  type Product,
  type PublicMenuData,
} from "@/lib/types";
import { Loading, Modal } from "./ui";
import { menuAppearance, themeStyle } from "@/lib/menu-theme";
import { LanguagePicker } from "./language-picker";
import { hasPendingMenuTranslation } from "@/lib/menu-translations";
type Unavailable = {
  suspended?: boolean;
  name?: string;
  message?: string;
  error?: string;
};
export function PublicMenu({
  slug,
  initialData,
}: {
  slug: string;
  initialData?: PublicMenuData;
}) {
  const [data, setData] = useState<PublicMenuData | null>(initialData || null);
  const [unavailable, setUnavailable] = useState<Unavailable | null>(null);
  const [loading, setLoading] = useState(!initialData);
  const [refreshFailed, setRefreshFailed] = useState(false);
  useEffect(() => {
    if (initialData) return;
    const controller = new AbortController();
    fetch("/api/public/menu/" + encodeURIComponent(slug), {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setData(null);
          setUnavailable(result);
          return;
        }
        setData(result);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setUnavailable({
            message:
              "No pudimos cargar este menú. Comprueba tu conexión e inténtalo de nuevo.",
          });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [slug, initialData]);
  useEffect(() => {
    if (!data) return;
    let controller: AbortController | null = null;
    let lastCheck = 0;
    const check = async () => {
      if (
        document.visibilityState === "hidden" ||
        Date.now() - lastCheck < 15000
      )
        return;
      lastCheck = Date.now();
      controller?.abort();
      controller = new AbortController();
      const current = controller;
      try {
        const version = await fetch(
          "/api/public/menu/" + encodeURIComponent(slug) + "/version",
          { signal: current.signal, cache: "no-store" },
        );
        const info = await version.json();
        if (current.signal.aborted) return;
        if (version.status === 404) {
          setUnavailable(info);
          setData(null);
          return;
        }
        if (
          version.ok &&
          info.status === "active" &&
          info.restaurantId === data.restaurant.id &&
          String(info.menu_version) === String(data.restaurant.menu_version)
        ) {
          setRefreshFailed(false);
          return;
        }
        const response = await fetch(
          "/api/public/menu/" + encodeURIComponent(slug),
          { signal: current.signal },
        );
        const result = await response.json();
        if (current.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 404 || response.status === 410) {
            setUnavailable(result);
            setData(null);
          } else setRefreshFailed(true);
          return;
        }
        if (result.restaurant.id !== data.restaurant.id) {
          setUnavailable({
            message:
              "La dirección del menú cambió. Vuelve a abrir el código QR del restaurante.",
          });
          setData(null);
          return;
        }
        setData(result);
        setRefreshFailed(false);
      } catch {
        if (!current.signal.aborted) setRefreshFailed(true);
      }
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      controller?.abort();
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [slug, data]);
  if (loading)
    return (
      <main className="public-loading">
        <Loading text="Preparando tu menú…" />
      </main>
    );
  if (!data)
    return (
      <main className="standalone-state">
        <span className="empty-icon">
          <UtensilsCrossed size={32} />
        </span>
        <h1>{unavailable?.name || "Este menú no está disponible"}</h1>
        <p>
          {unavailable?.message ||
            unavailable?.error ||
            "Comprueba la dirección del menú o vuelve a intentarlo más tarde."}
        </p>
        {!unavailable?.suspended && (
          <button
            className="button secondary"
            onClick={() => window.location.reload()}
          >
            Volver a intentar
          </button>
        )}
      </main>
    );
  return (
    <MenuRenderer
      key={data.restaurant.id}
      data={data}
      refreshFailed={refreshFailed}
    />
  );
}
export function MenuRenderer({
  data,
  preview = false,
  refreshFailed = false,
}: {
  data: PublicMenuData;
  preview?: boolean;
  refreshFailed?: boolean;
}) {
  const [chosenLanguage, setLanguage] = useState(
    data.restaurant.default_language || "es",
  );
  const enabled = languages.filter((l) =>
    (data.settings.enabled_languages || ["es"]).includes(l.code),
  );
  const language = enabled.some((l) => l.code === chosenLanguage)
    ? chosenLanguage
    : enabled[0]?.code || "es";
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [selectedId, setSelected] = useState<string | null>(null);
  const selected = data.products.find((p) => p.id === selectedId) || null;
  const [showHours, setShowHours] = useState(false);
  const [now] = useState(() => Date.now());
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        const saved = JSON.parse(
          localStorage.getItem("tolentino:favorites:" + data.restaurant.id) ||
            "[]",
        );
        if (Array.isArray(saved))
          setFavorites(saved.filter((v) => typeof v === "string"));
        const lang = localStorage.getItem(
          "tolentino:language:" + data.restaurant.id,
        );
        if (lang) setLanguage(lang);
      } catch {
        /* Storage is optional; state still works for this visit. */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [data.restaurant.id]);
  useEffect(() => {
    if (preview || !data.settings.appearance?.favicon_path) return;
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = mediaUrl(
      data.restaurant.id,
      data.settings.appearance.favicon_path,
    );
    link.dataset.tolentinoFavicon = data.restaurant.id;
    document.head.appendChild(link);
    return () => link.remove();
  }, [preview, data.restaurant.id, data.settings.appearance?.favicon_path]);
  function changeLanguage(value: string) {
    setLanguage(value);
    try {
      localStorage.setItem("tolentino:language:" + data.restaurant.id, value);
    } catch {
      /* Optional preference storage. */
    }
  }
  const t = copy[language] || copy.es;
  const appearance = menuAppearance(data.settings.appearance);
  function text(
    type: string,
    id: string,
    field: "name" | "description" | "title" | "ingredients",
    fallback: string,
  ) {
    const value = data.translations.find(
      (tr) =>
        tr.entity_type === type &&
        tr.entity_id === id &&
        tr.language === language,
    )?.fields[field];
    return typeof value === "string" && value.trim() ? value : fallback;
  }
  function optionText(
    id: string,
    field: "tags" | "extras" | "variants",
    index: number,
    fallback: string,
  ) {
    const value = data.translations.find(
      (tr) =>
        tr.entity_type === "product" &&
        tr.entity_id === id &&
        tr.language === language,
    )?.fields[field];
    if (!Array.isArray(value)) return fallback;
    const entry = value[index];
    return typeof entry === "string"
      ? entry.trim()
        ? entry
        : fallback
      : entry &&
          typeof entry === "object" &&
          "name" in entry &&
          typeof entry.name === "string" &&
          entry.name.trim()
        ? entry.name
        : fallback;
  }
  function favorite(id: string) {
    const next = favorites.includes(id)
      ? favorites.filter((x) => x !== id)
      : [...favorites, id];
    setFavorites(next);
    try {
      localStorage.setItem(
        "tolentino:favorites:" + data?.restaurant.id,
        JSON.stringify(next),
      );
    } catch {
      /* Favorites remain available for this visit when storage is disabled. */
    }
  }
  const orderedCategories = useMemo(() => {
    const categories = data?.categories || [];
    const visible = categories.filter((category) => category.is_visible);
    const roots = visible
      .filter((category) => !category.parent_id)
      .sort((a, b) => a.sort_order - b.sort_order);
    return roots.flatMap((root) => [
      root,
      ...visible
        .filter((child) => child.parent_id === root.id)
        .sort((a, b) => a.sort_order - b.sort_order),
    ]);
  }, [data]);
  const visibleProducts = useMemo(() => {
    if (!data) return [];
    const term = search
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    const categoryIds = [
      category,
      ...data.categories
        .filter((c) => c.parent_id === category)
        .map((c) => c.id),
    ];
    return data.products.filter(
      (p) =>
        p.is_published &&
        (!p.category_id ||
          orderedCategories.some(
            (category) => category.id === p.category_id,
          )) &&
        (category === "all" || categoryIds.includes(p.category_id || "")) &&
        (!onlyFavorites || favorites.includes(p.id)) &&
        (!term ||
          [
            p.name,
            p.description,
            p.ingredients,
            p.tags?.join(" "),
            ...data.translations
              .filter((tr) => tr.entity_id === p.id && tr.language === language)
              .flatMap((tr) => Object.values(tr.fields)),
          ]
            .join(" ")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .includes(term)),
    );
  }, [
    data,
    search,
    category,
    onlyFavorites,
    favorites,
    language,
    orderedCategories,
  ]);
  const r = data.restaurant;
  const pendingTranslation = hasPendingMenuTranslation(data, language);
  const featured = data.products.filter(
    (p) =>
      p.is_published &&
      p.is_featured &&
      orderedCategories.some((c) => c.id === p.category_id),
  );
  const groups = orderedCategories
    .map((c) => ({
      category: c,
      products: visibleProducts.filter((p) => p.category_id === c.id),
    }))
    .filter((g) => g.products.length);
  const uncategorized = visibleProducts.filter((p) => !p.category_id);
  return (
    <main
      className={"public-menu font-" + appearance.font}
      style={themeStyle(appearance)}
      data-menu-version={data.restaurant.menu_version}
      data-mobile-columns={appearance.columns_mobile}
      lang={language}
    >
      <header className="public-topbar">
        <a
          href={"/menu/" + r.slug}
          className="public-wordmark"
          onClick={(e) => {
            if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.ownerDocument.defaultView?.scrollTo({
                top: 0,
                behavior: "smooth",
              });
            }
          }}
        >
          {r.name}
        </a>
        <div>
          <button
            className={"favorite-nav " + (onlyFavorites ? "selected" : "")}
            aria-label={t.favorites}
            onClick={() => setOnlyFavorites(!onlyFavorites)}
          >
            <Heart size={18} fill={onlyFavorites ? "currentColor" : "none"} />
            <span>{t.favorites}</span>
            {favorites.length > 0 && <b>{favorites.length}</b>}
          </button>
          <LanguagePicker
            enabled={enabled}
            value={language}
            onChange={changeLanguage}
          />
        </div>
      </header>
      <section
        className={"menu-hero " + (!appearance.cover_path ? "no-cover" : "")}
      >
        {appearance.cover_path && (
          <img
            className="menu-cover"
            src={mediaUrl(r.id, appearance.cover_path)}
            alt=""
            fetchPriority="high"
          />
        )}
        <div className="menu-hero-shade" />
        <div className="menu-hero-inner">
          <span className="public-eyebrow">{t.digital}</span>
          {appearance.logo_path && (
            <img
              className="public-logo"
              src={mediaUrl(r.id, appearance.logo_path)}
              alt={r.name}
            />
          )}
          <h1>{r.name}</h1>
          {r.description && (
            <p>{text("restaurant", r.id, "description", r.description)}</p>
          )}
          {data.hours.length > 0 && (
            <button className="public-hours" onClick={() => setShowHours(true)}>
              <Clock3 size={15} />
              {t.hours}
              <ChevronDown size={14} />
            </button>
          )}
        </div>
        <div className="menu-hero-label">{t.hero}</div>
      </section>
      <div className="public-body">
        {refreshFailed && (
          <p className="menu-update-status" role="status">
            {t.refreshError}
          </p>
        )}
        {pendingTranslation && (
          <p className="menu-update-status" role="status">
            {t.pendingTranslation}
          </p>
        )}
        <div className="public-heading">
          <div>
            <span className="eyebrow">
              {onlyFavorites ? t.favorites : t.digital}
            </span>
            <h2>{onlyFavorites ? t.favorites : t.menu}</h2>
          </div>
          <div className="search-input public-search">
            <Search size={19} />
            <input
              type="search"
              value={search}
              placeholder={t.search}
              aria-label={t.search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <nav className="public-categories" aria-label={t.menu}>
          <button
            onClick={() => setCategory("all")}
            className={category === "all" ? "active" : ""}
            aria-pressed={category === "all"}
          >
            {t.all}
          </button>
          {orderedCategories.map((c) => (
            <button
              className={
                (category === c.id ? "active " : "") +
                (c.parent_id ? "subcategory" : "")
              }
              key={c.id}
              aria-pressed={category === c.id}
              title={
                c.parent_id
                  ? text(
                      "category",
                      c.parent_id,
                      "name",
                      data.categories.find(
                        (parent) => parent.id === c.parent_id,
                      )?.name || "",
                    )
                  : undefined
              }
              onClick={() => setCategory(c.id)}
            >
              {text("category", c.id, "name", c.name)}
            </button>
          ))}
        </nav>
        {data.promotions
          .filter(
            (p) =>
              p.is_active &&
              (!p.starts_at || Date.parse(p.starts_at) <= now) &&
              (!p.ends_at || Date.parse(p.ends_at) >= now),
          )
          .map((p) => (
            <aside className="public-promotion" key={p.id}>
              <Star size={20} />
              <div>
                <strong>
                  {text(
                    "promotion",
                    p.id,
                    "title",
                    text("promotion", p.id, "name", p.title),
                  )}
                </strong>
                <p>{text("promotion", p.id, "description", p.description)}</p>
              </div>
            </aside>
          ))}
        {featured.length > 0 && (
          <section className="featured-section">
            <div className="public-section-heading">
              <span className="eyebrow">{t.featured}</span>
              <span className="hairline" />
            </div>
            <div className="featured-grid">
              {featured.map((p) => (
                <article className="featured-product" key={p.id}>
                  <button
                    className="featured-product-main"
                    onClick={() => setSelected(p.id)}
                  >
                    {p.image_path ? (
                      <img
                        src={mediaUrl(r.id, p.image_path)}
                        alt={text("product", p.id, "name", p.name)}
                        loading="lazy"
                      />
                    ) : (
                      <div className="product-image-placeholder">
                        <UtensilsCrossed size={36} />
                      </div>
                    )}
                    <div>
                      <span className="product-category">
                        {text(
                          "category",
                          p.category_id || "",
                          "name",
                          data.categories.find((c) => c.id === p.category_id)
                            ?.name || "",
                        )}
                      </span>
                      <h3>{text("product", p.id, "name", p.name)}</h3>
                      <p>
                        {text("product", p.id, "description", p.description)}
                      </p>
                      <strong>{money(p.price, r.currency, language)}</strong>
                    </div>
                  </button>
                  <button
                    className={
                      "favorite-button " +
                      (favorites.includes(p.id) ? "is-favorite" : "")
                    }
                    aria-label={
                      favorites.includes(p.id) ? t.removeFavorite : t.favorite
                    }
                    onClick={() => favorite(p.id)}
                  >
                    <Heart
                      size={18}
                      fill={favorites.includes(p.id) ? "currentColor" : "none"}
                    />
                  </button>
                  {!p.is_available && (
                    <span className="sold-out">{t.unavailable}</span>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}
        {!visibleProducts.length ? (
          <div className="public-empty">
            <UtensilsCrossed size={33} strokeWidth={1.4} />
            <h3>{data.products.length ? t.empty : t.noMenu}</h3>
            <p>{data.products.length ? t.emptyText : ""}</p>
          </div>
        ) : (
          <>
            {groups.map((group) => (
              <section
                className={
                  "menu-category-section" +
                  (group.category.parent_id ? " subcategory-section" : "")
                }
                key={group.category.id}
              >
                <div className="public-section-heading">
                  <h2>
                    {text(
                      "category",
                      group.category.id,
                      "name",
                      group.category.name,
                    )}
                  </h2>
                  <span className="category-count">
                    {group.products.length}
                  </span>
                  <span className="hairline" />
                </div>
                <div className="public-product-grid">
                  {group.products.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      favorite={favorites.includes(p.id)}
                      onFavorite={() => favorite(p.id)}
                      onOpen={() => setSelected(p.id)}
                      name={text("product", p.id, "name", p.name)}
                      description={text(
                        "product",
                        p.id,
                        "description",
                        p.description,
                      )}
                      data={data}
                      language={language}
                    />
                  ))}
                </div>
              </section>
            ))}
            {uncategorized.length > 0 && (
              <section className="menu-category-section">
                <div className="public-product-grid">
                  {uncategorized.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      favorite={favorites.includes(p.id)}
                      onFavorite={() => favorite(p.id)}
                      onOpen={() => setSelected(p.id)}
                      name={text("product", p.id, "name", p.name)}
                      description={text(
                        "product",
                        p.id,
                        "description",
                        p.description,
                      )}
                      data={data}
                      language={language}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
      <footer className="public-footer">
        <strong>{r.name}</strong>
        <p>{t.digital}</p>
        {data.contact?.url && (
          <a
            className="creator-contact"
            href={data.contact.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {data.contact.brand
              ? t.createdBy +
                " " +
                data.contact.brand +
                (data.contact.phone ? " · " + data.contact.phone : "")
              : data.contact.label}
            <ArrowUpRight size={13} />
          </a>
        )}
        <a
          className="photo-credits-link"
          href={"/creditos-fotografias?restaurant=" + encodeURIComponent(r.id)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t.photoCredits}
        </a>
      </footer>
      {selected && (
        <Modal
          closeLabel={t.close}
          title={text("product", selected.id, "name", selected.name)}
          onClose={() => setSelected(null)}
          wide
        >
          <div className="product-detail">
            {selected.image_path && (
              <img
                className="detail-image"
                src={mediaUrl(r.id, selected.image_path)}
                alt={text("product", selected.id, "name", selected.name)}
              />
            )}
            <div className="detail-price">
              <strong>{money(selected.price, r.currency, language)}</strong>
              <span
                className={selected.is_available ? "available" : "unavailable"}
              >
                {selected.is_available ? t.available : t.unavailable}
              </span>
            </div>
            <p>
              {text(
                "product",
                selected.id,
                "description",
                selected.description,
              )}
            </p>
            {selected.tags?.length > 0 && (
              <div className="product-tags">
                {selected.tags.map((tag, index) => (
                  <span key={index}>
                    {optionText(selected.id, "tags", index, tag)}
                  </span>
                ))}
              </div>
            )}
            {selected.ingredients && (
              <div className="detail-block">
                <h3>{t.ingredients}</h3>
                <p>
                  {text(
                    "product",
                    selected.id,
                    "ingredients",
                    selected.ingredients,
                  )}
                </p>
              </div>
            )}
            {(
              [
                { key: "variants", label: t.variants },
                { key: "extras", label: t.extras },
              ] as const
            ).map(
              (group) =>
                selected[group.key]?.length > 0 && (
                  <div className="detail-block" key={group.key}>
                    <h3>{group.label}</h3>
                    {selected[group.key].map((v, i) => (
                      <div className="option-price" key={i}>
                        <span>
                          {optionText(selected.id, group.key, i, v.name)}
                        </span>
                        <strong>
                          {group.key === "extras" ? "+ " : ""}
                          {money(v.price, r.currency, language)}
                        </strong>
                      </div>
                    ))}
                  </div>
                ),
            )}
            <button
              className="button secondary"
              onClick={() => favorite(selected.id)}
            >
              <Heart
                size={17}
                fill={favorites.includes(selected.id) ? "currentColor" : "none"}
              />
              {favorites.includes(selected.id) ? t.removeFavorite : t.favorite}
            </button>
          </div>
        </Modal>
      )}
      {showHours && (
        <Modal
          closeLabel={t.close}
          title={t.hours}
          onClose={() => setShowHours(false)}
        >
          <dl className="details-list">
            {[1, 2, 3, 4, 5, 6, 0].map((day) => {
              const h = data.hours.find((x) => x.day_of_week === day);
              if (!h) return null;
              return (
                <div key={day}>
                  <dt>
                    {new Intl.DateTimeFormat(language, {
                      weekday: "long",
                    }).format(new Date(2026, 0, 4 + day))}
                  </dt>
                  <dd>
                    {h.is_closed
                      ? t.closed
                      : h.opens_at?.slice(0, 5) +
                        " – " +
                        h.closes_at?.slice(0, 5)}
                  </dd>
                </div>
              );
            })}
          </dl>
        </Modal>
      )}
    </main>
  );
}
function ProductCard({
  product: p,
  favorite,
  onFavorite,
  onOpen,
  name,
  description,
  data,
  language,
}: {
  product: Product;
  favorite: boolean;
  onFavorite: () => void;
  onOpen: () => void;
  name: string;
  description: string;
  data: PublicMenuData;
  language: string;
}) {
  const t = copy[language] || copy.es;
  return (
    <article
      className={
        "public-product " + (!p.is_available ? "product-unavailable" : "")
      }
    >
      <button className="public-product-main" onClick={onOpen}>
        <div className="public-product-info">
          {p.is_featured && (
            <span className="recommended">
              <Star size={11} />
              {t.featured}
            </span>
          )}
          <h3>{name}</h3>
          <p>{description}</p>
          <div className="public-product-bottom">
            <strong>
              {money(p.price, data.restaurant.currency, language)}
            </strong>
            {!p.is_available && (
              <span className="unavailable">{t.unavailable}</span>
            )}
          </div>
        </div>
        {p.image_path && (
          <img
            src={mediaUrl(data.restaurant.id, p.image_path)}
            alt={name}
            loading="lazy"
          />
        )}
      </button>
      <button
        className={"favorite-button small " + (favorite ? "is-favorite" : "")}
        aria-label={favorite ? t.removeFavorite : t.favorite}
        onClick={onFavorite}
      >
        <Heart size={16} fill={favorite ? "currentColor" : "none"} />
      </button>
    </article>
  );
}
