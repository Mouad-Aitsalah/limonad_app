import type { DriverTourCustomerDto } from "@/types/operations-dto";

/**
 * Custom marker content for the driver tour map's AdvancedMarkerElement markers.
 *
 * AdvancedMarkerElement renders arbitrary DOM as marker content (unlike legacy
 * Marker, which only accepted an icon URL/symbol), so each helper here returns
 * a real HTMLElement — an inline SVG badge, no external image request.
 *
 * AdvancedMarkerElement anchors its content at the BOTTOM CENTER by default
 * (to match a pin's tip). These badges are symmetric circular dots, not pins,
 * so each wrapper applies `transform: translate(0, 50%)` to shift the element
 * down by half its own height, turning the default bottom-anchor into a true
 * center-anchor — the GPS/customer coordinate is the badge's exact center.
 *
 * Glyphs reuse the exact path data from lucide-react's Truck and Store icons
 * (already the icon set used everywhere else in COMDIS) so the map stays visually
 * consistent with the rest of the app instead of introducing a second icon style.
 */

const TRUCK_GLYPH =
  [
    'd="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"',
    'd="M15 18H9"',
    'd="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"',
  ]
    .map((attrs) => `<path ${attrs}/>`)
    .join("") + '<circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>';

const STORE_GLYPH = [
  'd="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"',
  'd="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"',
  'd="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"',
]
  .map((attrs) => `<path ${attrs}/>`)
  .join("");

const STOP_GLYPH = ['d="M10 8v8"', 'd="M14 8v8"']
  .map((attrs) => `<path ${attrs}/>`)
  .join("");

const TRUCK_ICON_SIZE = 36;
const STORE_ICON_SIZE = 30;
const STORE_ICON_SIZE_EMPHASIZED = 34;
const STOP_ICON_SIZE = 28;

export const CUSTOMER_MARKER_COLORS = {
  toVisit: "#eab308",
  delivered: "#16a34a",
  noSale: "#ef4444",
  selected: "#2563eb",
} as const;

const TRUCK_COLOR = "#059669";
const STOP_COLOR = "#f59e0b";

function buildBadgeSvgMarkup({
  size,
  color,
  glyph,
  haloColor,
}: {
  size: number;
  color: string;
  glyph: string;
  haloColor?: string;
}) {
  const half = size / 2;
  const badgeRadius = half - 2.5;
  const glyphSize = size * 0.54;
  const glyphOffset = (size - glyphSize) / 2;
  const glyphScale = glyphSize / 24;

  const halo = haloColor
    ? `<circle cx="${half}" cy="${half}" r="${half - 0.5}" fill="${haloColor}" opacity="0.22"/>`
    : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<defs><filter id="s" x="-60%" y="-60%" width="220%" height="220%">` +
    `<feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#0f172a" flood-opacity="0.32"/>` +
    `</filter></defs>` +
    halo +
    `<g filter="url(#s)"><circle cx="${half}" cy="${half}" r="${badgeRadius}" fill="${color}" stroke="#ffffff" stroke-width="2.25"/></g>` +
    `<g transform="translate(${glyphOffset},${glyphOffset}) scale(${glyphScale})" fill="none" stroke="#ffffff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>` +
    `</svg>`
  );
}

function buildBadgeElement(options: {
  size: number;
  color: string;
  glyph: string;
  haloColor?: string;
  cursor?: string;
}): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.style.width = `${options.size}px`;
  wrapper.style.height = `${options.size}px`;
  wrapper.style.transform = "translate(0, 50%)";
  if (options.cursor) {
    wrapper.style.cursor = options.cursor;
  }
  wrapper.innerHTML = buildBadgeSvgMarkup(options);
  return wrapper;
}

/** Content for the driver truck AdvancedMarkerElement — center-anchored on the real GPS position. */
export function createTruckMarkerContent(): HTMLDivElement {
  return buildBadgeElement({
    size: TRUCK_ICON_SIZE,
    color: TRUCK_COLOR,
    glyph: TRUCK_GLYPH,
  });
}

function resolveCustomerStatusColor(status: DriverTourCustomerDto["visitStatus"]) {
  switch (status) {
    case "DELIVERED":
      return CUSTOMER_MARKER_COLORS.delivered;
    case "NO_SALE":
      return CUSTOMER_MARKER_COLORS.noSale;
    default:
      // PENDING / NEARBY / ARRIVED — still "a visiter" until delivered or marked without sale.
      return CUSTOMER_MARKER_COLORS.toVisit;
  }
}

/** Content for a customer AdvancedMarkerElement — a minimalist circular badge, not a classic map pin. */
export function createCustomerMarkerContent({
  status,
  selected,
  suggested,
}: {
  status: DriverTourCustomerDto["visitStatus"];
  selected: boolean;
  suggested: boolean;
}): HTMLDivElement {
  const statusColor = resolveCustomerStatusColor(status);
  const color = selected ? CUSTOMER_MARKER_COLORS.selected : statusColor;
  const size = selected || suggested ? STORE_ICON_SIZE_EMPHASIZED : STORE_ICON_SIZE;

  return buildBadgeElement({
    size,
    color,
    glyph: STORE_GLYPH,
    // Suggested customers keep their real status color but get a soft halo so
    // they stay distinguishable without introducing a 5th marker color.
    haloColor: suggested && !selected ? statusColor : undefined,
    cursor: "pointer",
  });
}

/** Content for a detected stop marker â€” small, distinct, and intentionally quieter than the truck marker. */
export function createStopMarkerContent({ active }: { active: boolean }): HTMLDivElement {
  return buildBadgeElement({
    size: STOP_ICON_SIZE,
    color: active ? "#d97706" : STOP_COLOR,
    glyph: STOP_GLYPH,
    haloColor: active ? STOP_COLOR : undefined,
    cursor: "pointer",
  });
}
