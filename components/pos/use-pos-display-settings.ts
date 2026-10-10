"use client";

import * as React from "react";

import {
  POS_DISPLAY_DEFAULTS,
  createPosDisplaySettingsStore,
  type PosDisplaySettings,
} from "@/lib/pos-display-settings";

/**
 * The counter POS display settings live in ONE module-level store (the POS is a
 * single page), so a slider move re-renders only the components that read it
 * (the panel, the catalogue wrapper, the grid) and never the whole POS layout.
 * Server snapshot = the defaults, so the first client render matches the
 * server's; the saved values of the signed-in user are applied right after.
 */
export const posDisplayStore = createPosDisplaySettingsStore({
  getStorage: () => (typeof window === "undefined" ? null : window.localStorage),
});

export function usePosDisplaySettings(): PosDisplaySettings {
  return React.useSyncExternalStore(
    posDisplayStore.subscribe,
    posDisplayStore.getSnapshot,
    () => POS_DISPLAY_DEFAULTS,
  );
}
