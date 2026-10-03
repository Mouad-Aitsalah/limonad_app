/**
 * Phone-only (< lg) look of the product tiles, shared by the admin / cashier
 * POS so it matches the driver POS: the product NAME on a tile is 19.5px with a
 * 25.5px line-height and a 51px two-line minimum height, long words wrap
 * instead of overflowing, and `unicode-bidi: plaintext` lets an Arabic name
 * start on its own side. Applied on a wrapper with descendant selectors on the
 * name paragraph only (ProductCard is shared): price, stock, the Ajouter pill
 * and the photo keep their own classes. Every rule is `max-lg:`, so the
 * desktop tiles are untouched.
 */
export const PHONE_PRODUCT_TILE_NAME_CLASS =
  "max-lg:[&_button_p.line-clamp-2]:[overflow-wrap:anywhere] max-lg:[&_button_p.line-clamp-2]:[unicode-bidi:plaintext] max-lg:[&_button_p.line-clamp-2]:min-h-[51px] max-lg:[&_button_p.line-clamp-2]:text-[19.5px] max-lg:[&_button_p.line-clamp-2]:leading-[25.5px]";
