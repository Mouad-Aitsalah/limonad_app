import assert from "node:assert/strict";
import { test } from "node:test";

import {
  POS_DISPLAY_DEFAULTS,
  POS_DISPLAY_LIMITS,
  POS_DISPLAY_NUMERIC_KEYS,
  clampDisplayValue,
  createPosDisplaySettingsStore,
  isDefaultPosDisplay,
  isValidDisplayScope,
  normalizePosDisplaySettings,
  parseStoredPosDisplaySettings,
  posDisplayCssVars,
  posDisplayStorageKey,
  serializePosDisplaySettings,
  type DisplayStorage,
} from "./pos-display-settings";

const alice = { organizationId: "org-1", userId: "user-alice" };
const bob = { organizationId: "org-1", userId: "user-bob" };

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const log: string[] = [];
  const storage: DisplayStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      log.push(`set ${key}`);
      data.set(key, value);
    },
    removeItem: (key) => {
      log.push(`remove ${key}`);
      data.delete(key);
    },
  };
  return { storage, data, log };
}

/** A store with a manual timer: `tick()` fires the pending debounced write. */
function makeStore(storage: DisplayStorage | null) {
  let pending: (() => void) | null = null;
  const store = createPosDisplaySettingsStore({
    getStorage: () => storage,
    schedule: (callback) => {
      pending = callback;
      return callback;
    },
    cancel: (handle) => {
      if (pending === handle) pending = null;
    },
  });
  return {
    store,
    tick: () => {
      const run = pending;
      pending = null;
      run?.();
    },
    hasPending: () => pending !== null,
  };
}

test("defaults and limits are exactly the specified ones", () => {
  assert.deepEqual(POS_DISPLAY_LIMITS, {
    nameSize: { min: 10, max: 28, default: 16 },
    cardMinWidth: { min: 110, max: 280, default: 150 },
    imageHeight: { min: 40, max: 180, default: 100 },
    gap: { min: 0, max: 24, default: 8 },
  });
  assert.deepEqual(POS_DISPLAY_DEFAULTS, { nameSize: 16, cardMinWidth: 150, imageHeight: 100, gap: 8, showPhotos: true });
  assert.equal(isDefaultPosDisplay(POS_DISPLAY_DEFAULTS), true);
  assert.equal(isDefaultPosDisplay({ ...POS_DISPLAY_DEFAULTS, gap: 9 }), false);
  assert.equal(isDefaultPosDisplay({ ...POS_DISPLAY_DEFAULTS, showPhotos: false }), false);
});

test("slider limits: every value in [min, max] is kept (continuous, one px steps), outside values are clamped", () => {
  for (const key of POS_DISPLAY_NUMERIC_KEYS) {
    const { min, max } = POS_DISPLAY_LIMITS[key];
    for (let value = min; value <= max; value++) assert.equal(clampDisplayValue(key, value), value, `${key}=${value}`);
    assert.equal(clampDisplayValue(key, min - 1), min);
    assert.equal(clampDisplayValue(key, min - 1000), min);
    assert.equal(clampDisplayValue(key, max + 1), max);
    assert.equal(clampDisplayValue(key, max + 1000), max);
  }
  // more than a few presets: 19 distinct name sizes, 171 distinct widths
  assert.equal(new Set(Array.from({ length: 19 }, (_, i) => clampDisplayValue("nameSize", 10 + i))).size, 19);
});

test("values are rounded to a whole px; unusable values fall back to the default", () => {
  assert.equal(clampDisplayValue("nameSize", 16.4), 16);
  assert.equal(clampDisplayValue("nameSize", 16.6), 17);
  assert.equal(clampDisplayValue("gap", "12"), 12);
  assert.equal(clampDisplayValue("gap", " 12 "), 12);
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, "", "abc", {}, [], true]) {
    assert.equal(clampDisplayValue("imageHeight", bad), 100, String(bad));
  }
});

test("normalize: partial, corrupt or foreign input always gives a complete valid object", () => {
  assert.deepEqual(normalizePosDisplaySettings(undefined), POS_DISPLAY_DEFAULTS);
  assert.deepEqual(normalizePosDisplaySettings(null), POS_DISPLAY_DEFAULTS);
  assert.deepEqual(normalizePosDisplaySettings("nope"), POS_DISPLAY_DEFAULTS);
  assert.deepEqual(normalizePosDisplaySettings({ nameSize: 22 }), { ...POS_DISPLAY_DEFAULTS, nameSize: 22 });
  assert.deepEqual(normalizePosDisplaySettings({ nameSize: 999, cardMinWidth: -5, imageHeight: "50", gap: "x", showPhotos: "yes" }), {
    nameSize: 28,
    cardMinWidth: 110,
    imageHeight: 50,
    gap: 8,
    showPhotos: true,
  });
  assert.equal(normalizePosDisplaySettings({ showPhotos: false }).showPhotos, false);
  assert.deepEqual(Object.keys(normalizePosDisplaySettings({ evil: 1, nameSize: 12 })).sort(), ["cardMinWidth", "gap", "imageHeight", "nameSize", "showPhotos"]);
});

test("css variables: px values for the four settings only", () => {
  assert.deepEqual(posDisplayCssVars(POS_DISPLAY_DEFAULTS), {
    "--pos-name-size": "16px",
    "--pos-card-min": "150px",
    "--pos-img-h": "100px",
    "--pos-gap": "8px",
  });
  assert.equal(posDisplayCssVars({ ...POS_DISPLAY_DEFAULTS, gap: 0 })["--pos-gap"], "0px");
});

test("storage key is isolated by organisation AND user; a value written for someone else is never read", () => {
  assert.equal(posDisplayStorageKey(alice), "comdis-pos-display:v1:org-1:user-alice");
  assert.notEqual(posDisplayStorageKey(alice), posDisplayStorageKey(bob));
  assert.notEqual(posDisplayStorageKey(alice), posDisplayStorageKey({ ...alice, organizationId: "org-2" }));
  const raw = serializePosDisplaySettings({ ...POS_DISPLAY_DEFAULTS, nameSize: 20 }, alice);
  assert.equal(parseStoredPosDisplaySettings(raw, alice)?.nameSize, 20);
  assert.equal(parseStoredPosDisplaySettings(raw, bob), null);
  assert.equal(parseStoredPosDisplaySettings(raw, { ...alice, organizationId: "org-2" }), null);
  for (const bad of [null, undefined, "", "{", "[]", "null", '{"v":2}', JSON.stringify({ v: 1, organizationId: "org-1", userId: "user-alice" }), JSON.stringify({ v: 1, organizationId: "org-1", userId: "user-alice", settings: "x" })]) {
    assert.equal(parseStoredPosDisplaySettings(bad, alice), null, String(bad));
  }
  // a tampered stored value is clamped on read
  const tampered = JSON.stringify({ v: 1, organizationId: "org-1", userId: "user-alice", settings: { nameSize: 500, gap: -3 } });
  assert.deepEqual(parseStoredPosDisplaySettings(tampered, alice), { ...POS_DISPLAY_DEFAULTS, nameSize: 28, gap: 0 });
});

test("scope validation: only plain ids are accepted (no path-like or empty ids)", () => {
  assert.equal(isValidDisplayScope(alice), true);
  assert.equal(isValidDisplayScope(null), false);
  assert.equal(isValidDisplayScope({ organizationId: "", userId: "u" }), false);
  assert.equal(isValidDisplayScope({ organizationId: "o", userId: "a:b" }), false);
  assert.equal(isValidDisplayScope({ organizationId: "o", userId: "x".repeat(65) }), false);
});

test("store: starts at the defaults; update applies immediately and notifies once per real change", () => {
  const { storage } = fakeStorage();
  const { store } = makeStore(storage);
  let calls = 0;
  const unsubscribe = store.subscribe(() => calls++);
  assert.deepEqual(store.getSnapshot(), POS_DISPLAY_DEFAULTS);
  store.update({ nameSize: 20 });
  assert.equal(store.getSnapshot().nameSize, 20);
  assert.equal(calls, 1);
  store.update({ nameSize: 20 }); // no real change
  store.update({ nameSize: 20.2 }); // rounds to the same value
  assert.equal(calls, 1);
  store.update({ nameSize: 999 }); // clamped
  assert.equal(store.getSnapshot().nameSize, 28);
  unsubscribe();
  store.update({ gap: 3 });
  assert.equal(calls, 2, "no notification after unsubscribe");
});

test("store: preferences are saved (debounced) per user and restored after a reload", () => {
  const { storage, data, log } = fakeStorage();
  const first = makeStore(storage);
  first.store.setScope(alice);
  first.store.update({ nameSize: 22 });
  first.store.update({ cardMinWidth: 200 });
  first.store.update({ imageHeight: 60, gap: 4, showPhotos: false });
  assert.equal(log.length, 0, "nothing written while the slider is still moving");
  assert.equal(first.hasPending(), true);
  first.tick();
  assert.deepEqual(log, ["set comdis-pos-display:v1:org-1:user-alice"], "one write for the whole gesture");
  assert.ok(data.has(posDisplayStorageKey(alice)));

  // a "reload": a brand new store reading the same storage
  const second = makeStore(storage);
  assert.deepEqual(second.store.getSnapshot(), POS_DISPLAY_DEFAULTS, "defaults until the user is known");
  second.store.setScope(alice);
  assert.deepEqual(second.store.getSnapshot(), { nameSize: 22, cardMinWidth: 200, imageHeight: 60, gap: 4, showPhotos: false });
});

test("store: each user has their own settings on the same browser", () => {
  const { storage } = fakeStorage();
  const { store, tick } = makeStore(storage);
  store.setScope(alice);
  store.update({ nameSize: 24 });
  tick();
  store.setScope(bob);
  assert.deepEqual(store.getSnapshot(), POS_DISPLAY_DEFAULTS, "bob does not inherit alice's settings");
  store.update({ gap: 20 });
  tick();
  store.setScope(alice);
  assert.equal(store.getSnapshot().nameSize, 24);
  assert.equal(store.getSnapshot().gap, 8);
  store.setScope(bob);
  assert.equal(store.getSnapshot().gap, 20);
  assert.equal(store.getSnapshot().nameSize, 16);
});

test("store: switching user flushes the previous user's pending change to the RIGHT key", () => {
  const { storage, data } = fakeStorage();
  const { store } = makeStore(storage);
  store.setScope(alice);
  store.update({ nameSize: 26 }); // pending, not written yet
  store.setScope(bob);
  assert.equal(parseStoredPosDisplaySettings(data.get(posDisplayStorageKey(alice)), alice)?.nameSize, 26);
  assert.equal(data.has(posDisplayStorageKey(bob)), false);
});

test("store: reset restores every default, removes the saved entry and cancels a pending write", () => {
  const { storage, data } = fakeStorage();
  const { store, tick, hasPending } = makeStore(storage);
  store.setScope(alice);
  store.update({ nameSize: 12, cardMinWidth: 250, imageHeight: 150, gap: 20, showPhotos: false });
  tick();
  assert.ok(data.has(posDisplayStorageKey(alice)));
  store.update({ nameSize: 14 }); // pending
  store.reset();
  assert.deepEqual(store.getSnapshot(), POS_DISPLAY_DEFAULTS);
  assert.equal(data.has(posDisplayStorageKey(alice)), false);
  assert.equal(hasPending(), false);
  tick();
  assert.equal(data.has(posDisplayStorageKey(alice)), false, "the cancelled write never happens");
  // and a reload gives the defaults
  const reloaded = makeStore(storage);
  reloaded.store.setScope(alice);
  assert.deepEqual(reloaded.store.getSnapshot(), POS_DISPLAY_DEFAULTS);
});

test("store: without a signed-in scope nothing is ever written and the settings still apply on screen", () => {
  const { storage, log } = fakeStorage();
  const { store, hasPending } = makeStore(storage);
  store.setScope(null);
  store.update({ nameSize: 25 });
  assert.equal(store.getSnapshot().nameSize, 25);
  assert.equal(hasPending(), false);
  store.reset();
  store.setScope({ organizationId: "", userId: "" });
  store.update({ gap: 1 });
  assert.deepEqual(log, []);
});

test("store: corrupt or throwing storage never breaks the POS", () => {
  const corrupt = fakeStorage({ [posDisplayStorageKey(alice)]: "{not json" });
  const a = makeStore(corrupt.storage);
  a.store.setScope(alice);
  assert.deepEqual(a.store.getSnapshot(), POS_DISPLAY_DEFAULTS);

  const throwing: DisplayStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  const b = makeStore(throwing);
  b.store.setScope(alice);
  b.store.update({ nameSize: 18 });
  b.tick();
  b.store.reset();
  assert.deepEqual(b.store.getSnapshot(), POS_DISPLAY_DEFAULTS);

  const c = makeStore(null); // no storage at all (server render, locked-down browser)
  c.store.setScope(alice);
  c.store.update({ gap: 2 });
  c.tick();
  assert.equal(c.store.getSnapshot().gap, 2);
});

test("store: setting the same scope again does not reload or reset what is on screen", () => {
  const { storage } = fakeStorage();
  const { store } = makeStore(storage);
  store.setScope(alice);
  store.update({ nameSize: 21 });
  store.setScope({ ...alice });
  assert.equal(store.getSnapshot().nameSize, 21);
});

// ---------------------------------------------------------------------------
// Phone default: two cards per row
// ---------------------------------------------------------------------------

/** How many columns `repeat(auto-fill, minmax(min(<min>, 100%), 1fr))` produces in a container. */
function columnsFor(containerWidth: number, minWidth: number, gap: number) {
  return Math.max(1, Math.floor((containerWidth + gap) / (minWidth + gap)));
}
/** The catalogue is the screen width minus 16 px of page padding on each side (343 px on a 375 px phone, measured in the POS). */
const catalogueWidth = (screenWidth: number) => screenWidth - 32;

test("phone default: two product cards per row from a 340 px screen up (375 px: two cards of 167.5 px)", () => {
  const { cardMinWidth, gap } = POS_DISPLAY_DEFAULTS;
  assert.equal(cardMinWidth, 150);
  for (const screen of [340, 360, 375, 390, 412, 430]) {
    assert.equal(columnsFor(catalogueWidth(screen), cardMinWidth, gap), 2, `${screen}px`);
  }
  assert.equal(catalogueWidth(375), 343);
  assert.equal((343 - gap) / 2, 167.5, "each card is 167.5 px wide on a 375 px phone");
  assert.ok((343 - gap) / 2 >= cardMinWidth, "no card is narrower than the minimum");
  // the widest gap still keeps two columns on a 375 px phone
  assert.equal(columnsFor(343, cardMinWidth, POS_DISPLAY_LIMITS.gap.max), 2);
});

test("the card width slider still changes the number of columns: wider = fewer, narrower = more, back to the default = two", () => {
  const phone = catalogueWidth(375);
  assert.equal(columnsFor(phone, POS_DISPLAY_LIMITS.cardMinWidth.max, 8), 1, "280 px: one big card per row");
  assert.equal(columnsFor(phone, 170, 8), 1, "the former default (170 px) gave a single column");
  assert.equal(columnsFor(phone, POS_DISPLAY_LIMITS.cardMinWidth.min, 8), 2, "110 px: still two (three would need 346 px)");
  // a PC catalogue (half of a 1366 px screen) keeps its two cards per row at the default
  assert.equal(columnsFor(445, POS_DISPLAY_DEFAULTS.cardMinWidth, POS_DISPLAY_DEFAULTS.gap), 2);
  // reset gives the default width back
  const { store } = makeStore(fakeStorage().storage);
  store.update({ cardMinWidth: 280 });
  assert.equal(columnsFor(phone, store.getSnapshot().cardMinWidth, store.getSnapshot().gap), 1);
  store.reset();
  assert.equal(columnsFor(phone, store.getSnapshot().cardMinWidth, store.getSnapshot().gap), 2);
});
