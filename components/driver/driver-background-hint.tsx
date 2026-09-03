"use client";

import * as React from "react";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { BatteryCharging, X } from "lucide-react";

import { openNativeAppSettings } from "@/lib/gps/native-tracking";
import { Button } from "@/components/ui/button";

/**
 * Phase 5C - a one-time, dismissible notice shown only inside the native
 * Android app. Android battery optimisation / OEM task-killers can freeze the
 * background location service; there is no reliable API to detect that, so
 * this simply guides the driver to the app settings once. Dismissing it (or
 * opening the settings) hides it for good - no repeat popups.
 */
const DISMISSED_KEY = "comdis.driver.bgHintDismissed.v1";

export function DriverBackgroundHint() {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    Preferences.get({ key: DISMISSED_KEY })
      .then(({ value }) => {
        if (!cancelled && value !== "1") setVisible(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = React.useCallback(() => {
    setVisible(false);
    void Preferences.set({ key: DISMISSED_KEY, value: "1" }).catch(() => undefined);
  }, []);

  if (!visible) return null;

  return (
    <div className="flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <BatteryCharging aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="flex-1 space-y-2">
        <p>
          Pour assurer le suivi de la tournée, autorisez COMDIS à fonctionner en
          arrière-plan (désactivez l&apos;optimisation de batterie pour l&apos;app).
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-amber-300 bg-white"
            onClick={() => {
              void openNativeAppSettings();
              dismiss();
            }}
          >
            Ouvrir les réglages
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={dismiss}>
            Plus tard
          </Button>
        </div>
      </div>
      <button
        type="button"
        aria-label="Fermer"
        onClick={dismiss}
        className="shrink-0 rounded p-1 text-amber-700 hover:bg-amber-100"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}
