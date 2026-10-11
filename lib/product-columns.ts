/**
 * Columns of the /produits table (desktop table only - the phone cards are not
 * affected) and the organisation-wide choice of which ones are shown.
 *
 * Scope: ONE choice per organisation, made by an admin (Paramètres d'affichage
 * on /produits), stored in Organization.productColumnSettings and applied to
 * every user on every device. Display only: hiding a column never touches a
 * product, the import, the stock or the POS.
 *
 * Stored shape: { "columns": { "<column key>": true | false } }. A column the
 * admin never toggled (or added after the choice was saved) keeps its default;
 * unknown keys and non-boolean values are ignored, so a stale or hand-edited
 * value can never break the table. Pure: the browser, the server and the tests
 * import it.
 */

export const PRODUCT_COLUMN_KEYS = [
  "photo",
  "reference",
  "designation",
  "category",
  "supplier",
  "purchasePriceTTC",
  "retailPriceTTC",
  "semiWholesalePriceTTC",
  "salePriceTTC",
  "semiWholesaleMinQty",
  "wholesaleMinQty",
  "unit",
  "taxRate",
  "stockQuantity",
  "minimumStock",
  "status",
] as const;

export type ProductColumnKey = (typeof PRODUCT_COLUMN_KEYS)[number];

export type ProductColumnDefinition = {
  key: ProductColumnKey;
  /** Table header - the existing columns keep exactly their current header. */
  header: string;
  /** Name in the settings panel (more explicit than the header when needed). */
  label: string;
  defaultVisible: boolean;
  /** Always shown: the table is unusable without it. */
  locked?: boolean;
  align?: "right";
};

/** In table order. The "Actions" column is not configurable (always last). */
export const PRODUCT_COLUMNS: readonly ProductColumnDefinition[] = [
  { key: "photo", header: "Photo", label: "Photo", defaultVisible: true },
  { key: "reference", header: "Reference", label: "Référence produit", defaultVisible: true },
  { key: "designation", header: "Designation", label: "Désignation", defaultVisible: true, locked: true },
  { key: "category", header: "Categorie", label: "Type (catégorie)", defaultVisible: true },
  { key: "supplier", header: "Fournisseur", label: "Fournisseur", defaultVisible: true },
  { key: "purchasePriceTTC", header: "Prix achat TTC", label: "Prix d'achat TTC", defaultVisible: true, align: "right" },
  { key: "retailPriceTTC", header: "Prix détail TTC", label: "Prix détail TTC", defaultVisible: false, align: "right" },
  {
    key: "semiWholesalePriceTTC",
    header: "Prix semi-gros TTC",
    label: "Prix semi-gros TTC",
    defaultVisible: false,
    align: "right",
  },
  { key: "salePriceTTC", header: "Prix vente TTC", label: "Prix gros TTC (prix de vente)", defaultVisible: true, align: "right" },
  { key: "semiWholesaleMinQty", header: "Qped", label: "Qped (seuil semi-gros)", defaultVisible: false, align: "right" },
  { key: "wholesaleMinQty", header: "Qgros", label: "Qgros (seuil gros)", defaultVisible: false, align: "right" },
  { key: "unit", header: "Unité", label: "Unité", defaultVisible: false },
  { key: "taxRate", header: "TVA", label: "Taux de TVA", defaultVisible: true, align: "right" },
  {
    key: "stockQuantity",
    header: "Qté en stock",
    label: "Quantité en stock (tous emplacements)",
    defaultVisible: false,
    align: "right",
  },
  { key: "minimumStock", header: "Stock min.", label: "Stock minimum", defaultVisible: true, align: "right" },
  { key: "status", header: "Statut", label: "Statut", defaultVisible: true },
];

export type ProductColumnSettings = {
  columns: Partial<Record<ProductColumnKey, boolean>>;
};

export const DEFAULT_PRODUCT_COLUMN_SETTINGS: ProductColumnSettings = { columns: {} };

function isColumnKey(value: string): value is ProductColumnKey {
  return (PRODUCT_COLUMN_KEYS as readonly string[]).includes(value);
}

/**
 * Whatever is stored (or sent) -> a clean settings object: only known column
 * keys with a boolean value; a locked column is never stored as hidden.
 */
export function parseProductColumnSettings(value: unknown): ProductColumnSettings {
  const columns: Partial<Record<ProductColumnKey, boolean>> = {};
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as { columns?: unknown }).columns
      : null;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, visible] of Object.entries(raw as Record<string, unknown>)) {
      if (!isColumnKey(key) || typeof visible !== "boolean") continue;
      const definition = PRODUCT_COLUMNS.find((column) => column.key === key);
      if (definition?.locked) continue;
      columns[key] = visible;
    }
  }
  return { columns };
}

export function isProductColumnVisible(settings: ProductColumnSettings, key: ProductColumnKey): boolean {
  const definition = PRODUCT_COLUMNS.find((column) => column.key === key);
  if (!definition) return false;
  if (definition.locked) return true;
  return settings.columns[key] ?? definition.defaultVisible;
}

/** The visible columns, in table order. */
export function visibleProductColumns(settings: ProductColumnSettings): ProductColumnDefinition[] {
  return PRODUCT_COLUMNS.filter((column) => isProductColumnVisible(settings, column.key));
}

/** The settings with one column switched (a locked column cannot be hidden). */
export function withProductColumnVisibility(
  settings: ProductColumnSettings,
  key: ProductColumnKey,
  visible: boolean,
): ProductColumnSettings {
  const definition = PRODUCT_COLUMNS.find((column) => column.key === key);
  if (!definition || definition.locked) return settings;
  return { columns: { ...settings.columns, [key]: visible } };
}
