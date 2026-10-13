import {
  ASSISTANT_TOOL_MODULES,
  MODULES,
  isEssentialModule,
  isModuleKey,
  type ModuleKey,
} from "@/lib/modules/registry";

/**
 * Organization.moduleSettings, as stored: { "modules": { "<module key>": boolean } }.
 *
 * Defaults, explicitly: every module is ENABLED - a NULL column (every existing
 * organisation, and every new one), a missing key (a module added to the code
 * later), an unknown key, a non-boolean value or a malformed JSON all fall back
 * to "enabled", so an old or hand-edited value can never lock an organisation
 * out by accident. Only an explicit `false` disables a module, and an essential
 * module is never disabled, whatever is stored.
 *
 * Pure: the browser, the server and the tests import it.
 */

export type ModuleSettings = { modules: Partial<Record<ModuleKey, boolean>> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Whatever is stored -> only known, non-essential keys with a boolean. */
export function parseModuleSettings(stored: unknown): ModuleSettings {
  const modules: Partial<Record<ModuleKey, boolean>> = {};
  const raw = isRecord(stored) ? stored.modules : undefined;
  if (isRecord(raw)) {
    for (const [key, enabled] of Object.entries(raw)) {
      if (!isModuleKey(key) || isEssentialModule(key) || typeof enabled !== "boolean") continue;
      modules[key] = enabled;
    }
  }
  return { modules };
}

/** The disabled modules of an organisation (sorted, registry order). */
export function disabledModulesFromSettings(stored: unknown): ModuleKey[] {
  const { modules } = parseModuleSettings(stored);
  return MODULES.filter((module) => modules[module.key] === false).map((module) => module.key);
}

export function isModuleEnabled(disabledModules: readonly string[] | undefined, key: ModuleKey): boolean {
  if (isEssentialModule(key)) return true;
  return !(disabledModules ?? []).includes(key);
}

/**
 * A page / route / tool shared by several modules is available when AT LEAST
 * ONE of them is enabled. An empty list = not tied to any module (always).
 */
export function isAnyModuleEnabled(
  disabledModules: readonly string[] | undefined,
  modules: readonly ModuleKey[],
): boolean {
  return modules.length === 0 || modules.some((key) => isModuleEnabled(disabledModules, key));
}

/**
 * An assistant tool is offered and run only when one of its modules is enabled
 * (registry ASSISTANT_TOOL_MODULES); an unknown tool is never allowed.
 */
export function isAssistantToolAllowed(name: string | undefined, disabledModules: readonly string[] | undefined): boolean {
  const modules = name ? ASSISTANT_TOOL_MODULES[name] : undefined;
  return modules !== undefined && isAnyModuleEnabled(disabledModules, modules);
}

export type ModuleState = { key: ModuleKey; enabled: boolean };

/** Every module with its effective state, in registry order (SUPER_ADMIN screen). */
export function resolveModuleStates(stored: unknown): ModuleState[] {
  const disabled = disabledModulesFromSettings(stored);
  return MODULES.map((module) => ({ key: module.key, enabled: isModuleEnabled(disabled, module.key) }));
}

export type ModuleSettingsInputResult =
  | { ok: true; settings: ModuleSettings }
  | { ok: false; message: string };

/**
 * The SUPER_ADMIN's request body ({ modules: { key: boolean } }) -> the settings
 * to store. Strict, unlike the read path: an unknown module, a non-boolean value
 * or an attempt to disable an essential module is REFUSED with a clear message
 * rather than silently ignored. Only `false` values are kept (enabled is the
 * default), so the stored JSON stays minimal.
 */
export function validateModuleSettingsInput(input: unknown): ModuleSettingsInputResult {
  const raw = isRecord(input) ? input.modules : undefined;
  if (!isRecord(raw)) return { ok: false, message: "Configuration des modules invalide." };
  const modules: Partial<Record<ModuleKey, boolean>> = {};
  for (const [key, enabled] of Object.entries(raw)) {
    if (!isModuleKey(key)) return { ok: false, message: `Module inconnu : « ${key} ».` };
    if (typeof enabled !== "boolean") {
      return { ok: false, message: `Valeur invalide pour le module « ${key} ».` };
    }
    if (isEssentialModule(key)) {
      if (!enabled) return { ok: false, message: `Le module « ${key} » est essentiel et ne peut pas être désactivé.` };
      continue;
    }
    if (!enabled) modules[key] = false;
  }
  return { ok: true, settings: { modules } };
}
