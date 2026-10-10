/**
 * Counter POS "Personnaliser l'affichage": per-user visual settings of the
 * product catalogue (name size, minimum card width, photo height, gap between
 * the cards, photos on/off). Purely visual - nothing here touches a price, a
 * stock level, a cart or a sale.
 *
 * Isomorphic and storage-injected (no `window`), so every rule is unit-tested:
 *  - the four sliders have a minimum, a maximum and a default; any stored or
 *    typed value is rounded and clamped, anything unusable falls back to the
 *    default (a corrupt entry never breaks the POS);
 *  - the preferences are kept per ORGANISATION + USER in the browser's
 *    localStorage (the project has no user-preference table; adding one would
 *    need a migration). The stored value repeats both ids and they are
 *    re-checked on read, so another account on the same browser never reads
 *    them. They stay on that browser and are NOT synchronised between devices;
 *  - without a signed-in scope (not authenticated yet) the settings apply for
 *    the current page only and nothing is written.
 */

export type PosDisplaySettings = {
  /** Product name font size, px. */
  nameSize: number;
  /** Minimum width of a product card, px - drives how many cards fit per row. */
  cardMinWidth: number;
  /** Height of the product photo, px. */
  imageHeight: number;
  /** Gap between the cards, px. */
  gap: number;
  showPhotos: boolean;
};

export type PosDisplayNumericKey = "nameSize" | "cardMinWidth" | "imageHeight" | "gap";

/**
 * cardMinWidth default = 150 px. On a 375 px phone the catalogue is 343 px wide
 * (16 px page padding on each side), and with the default 8 px gap two cards
 * need 2 x min + 8 <= 343, i.e. a minimum of at most 167 px: 150 gives two
 * cards of 167.5 px, keeps two columns down to a 340 px screen and with the
 * widest gap (24 px) on a 375 px one, and on a PC (half-width catalogue) still
 * gives two or three cards per row. The slider goes from 110 to 280 px.
 */
export const POS_DISPLAY_LIMITS: Record<PosDisplayNumericKey, { min: number; max: number; default: number }> = {
  nameSize: { min: 10, max: 28, default: 16 },
  cardMinWidth: { min: 110, max: 280, default: 150 },
  imageHeight: { min: 40, max: 180, default: 100 },
  gap: { min: 0, max: 24, default: 8 },
};

export const POS_DISPLAY_NUMERIC_KEYS = Object.keys(POS_DISPLAY_LIMITS) as PosDisplayNumericKey[];

export const POS_DISPLAY_DEFAULTS: PosDisplaySettings = {
  nameSize: POS_DISPLAY_LIMITS.nameSize.default,
  cardMinWidth: POS_DISPLAY_LIMITS.cardMinWidth.default,
  imageHeight: POS_DISPLAY_LIMITS.imageHeight.default,
  gap: POS_DISPLAY_LIMITS.gap.default,
  showPhotos: true,
};

/** A slider value: rounded to a whole px and kept inside [min, max]; unusable input -> the default. */
export function clampDisplayValue(key: PosDisplayNumericKey, value: unknown): number {
  const limits = POS_DISPLAY_LIMITS[key];
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(number)) return limits.default;
  return Math.min(limits.max, Math.max(limits.min, Math.round(number)));
}

/** Any input (stored JSON, a patch...) -> a complete, valid settings object. */
export function normalizePosDisplaySettings(input: unknown): PosDisplaySettings {
  const source = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof PosDisplaySettings, unknown>>;
  return {
    nameSize: clampDisplayValue("nameSize", source.nameSize),
    cardMinWidth: clampDisplayValue("cardMinWidth", source.cardMinWidth),
    imageHeight: clampDisplayValue("imageHeight", source.imageHeight),
    gap: clampDisplayValue("gap", source.gap),
    showPhotos: typeof source.showPhotos === "boolean" ? source.showPhotos : POS_DISPLAY_DEFAULTS.showPhotos,
  };
}

export function samePosDisplaySettings(a: PosDisplaySettings, b: PosDisplaySettings): boolean {
  return (
    a.nameSize === b.nameSize &&
    a.cardMinWidth === b.cardMinWidth &&
    a.imageHeight === b.imageHeight &&
    a.gap === b.gap &&
    a.showPhotos === b.showPhotos
  );
}

export function isDefaultPosDisplay(settings: PosDisplaySettings): boolean {
  return samePosDisplaySettings(settings, POS_DISPLAY_DEFAULTS);
}

/** The CSS variables the catalogue reads (set on the catalogue wrapper only). */
export function posDisplayCssVars(settings: PosDisplaySettings): Record<string, string> {
  return {
    "--pos-name-size": `${settings.nameSize}px`,
    "--pos-card-min": `${settings.cardMinWidth}px`,
    "--pos-img-h": `${settings.imageHeight}px`,
    "--pos-gap": `${settings.gap}px`,
  };
}

// ---------------------------------------------------------------------------
// Storage (per organisation + user)
// ---------------------------------------------------------------------------

export type DisplayScope = { organizationId: string; userId: string };
export type DisplayStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY_PREFIX = "comdis-pos-display:v1";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidDisplayScope(scope: DisplayScope | null | undefined): scope is DisplayScope {
  return Boolean(scope && ID_PATTERN.test(scope.organizationId) && ID_PATTERN.test(scope.userId));
}

export function posDisplayStorageKey(scope: DisplayScope): string {
  return `${KEY_PREFIX}:${scope.organizationId}:${scope.userId}`;
}

export function serializePosDisplaySettings(settings: PosDisplaySettings, scope: DisplayScope): string {
  return JSON.stringify({ v: 1, organizationId: scope.organizationId, userId: scope.userId, settings });
}

/** The stored settings, or null when missing, malformed or written for another organisation/user. */
export function parseStoredPosDisplaySettings(raw: string | null | undefined, scope: DisplayScope): PosDisplaySettings | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; organizationId?: unknown; userId?: unknown; settings?: unknown };
    if (parsed.v !== 1 || parsed.organizationId !== scope.organizationId || parsed.userId !== scope.userId) return null;
    if (!parsed.settings || typeof parsed.settings !== "object") return null;
    return normalizePosDisplaySettings(parsed.settings);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The store (framework-free; the React hook subscribes to it)
// ---------------------------------------------------------------------------

export type PosDisplaySettingsStore = {
  getSnapshot: () => PosDisplaySettings;
  subscribe: (listener: () => void) => () => void;
  /** The signed-in user (null = not authenticated: settings apply for this page only, nothing is saved). */
  setScope: (scope: DisplayScope | null) => void;
  getScope: () => DisplayScope | null;
  update: (patch: Partial<PosDisplaySettings>) => void;
  reset: () => void;
  /** Writes a pending change now (page leaving, user switching). */
  flush: () => void;
};

export function createPosDisplaySettingsStore(options: {
  getStorage: () => DisplayStorage | null;
  /** The debounce before a slider move is written (default 250 ms). */
  debounceMs?: number;
  schedule?: (callback: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}): PosDisplaySettingsStore {
  const debounceMs = options.debounceMs ?? 250;
  const schedule = options.schedule ?? ((callback, ms) => setTimeout(callback, ms));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const listeners = new Set<() => void>();
  let settings: PosDisplaySettings = POS_DISPLAY_DEFAULTS;
  let scope: DisplayScope | null = null;
  let pending: unknown = null;

  const notify = () => listeners.forEach((listener) => listener());
  const storage = () => {
    try {
      return options.getStorage();
    } catch {
      return null;
    }
  };

  function write() {
    pending = null;
    if (!scope) return;
    try {
      storage()?.setItem(posDisplayStorageKey(scope), serializePosDisplaySettings(settings, scope));
    } catch {
      // private mode / quota: the settings still apply for this page
    }
  }

  function flush() {
    if (pending === null) return;
    cancel(pending);
    write();
  }

  return {
    getSnapshot: () => settings,
    getScope: () => scope,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setScope(next) {
      const valid = isValidDisplayScope(next) ? next : null;
      const same = valid && scope && valid.organizationId === scope.organizationId && valid.userId === scope.userId;
      if (same || (!valid && !scope)) return;
      flush();
      scope = valid;
      if (!valid) return; // signed out / unknown: keep what is on screen, save nothing
      let stored: PosDisplaySettings | null = null;
      try {
        stored = parseStoredPosDisplaySettings(storage()?.getItem(posDisplayStorageKey(valid)), valid);
      } catch {
        stored = null;
      }
      const next_ = stored ?? POS_DISPLAY_DEFAULTS;
      if (!samePosDisplaySettings(next_, settings)) {
        settings = next_;
        notify();
      }
    },
    update(patch) {
      const next = normalizePosDisplaySettings({ ...settings, ...patch });
      if (samePosDisplaySettings(next, settings)) return;
      settings = next;
      notify();
      if (scope) {
        if (pending !== null) cancel(pending);
        pending = schedule(write, debounceMs);
      }
    },
    reset() {
      if (pending !== null) {
        cancel(pending);
        pending = null;
      }
      const changed = !samePosDisplaySettings(settings, POS_DISPLAY_DEFAULTS);
      settings = POS_DISPLAY_DEFAULTS;
      if (scope) {
        try {
          storage()?.removeItem(posDisplayStorageKey(scope));
        } catch {
          // ignore
        }
      }
      if (changed) notify();
    },
    flush,
  };
}
