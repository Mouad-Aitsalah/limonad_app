import "server-only";

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";

import { decideApiModuleAccess, readOrganizationDisabledModules } from "@/lib/modules/module-access-core";
import type { ModuleKey } from "@/lib/modules/registry";
import { isModuleEnabled } from "@/lib/modules/settings";
import { prisma } from "@/lib/prisma";
import { AuthServiceError, getCurrentSessionUser } from "@/lib/server/auth";

/**
 * Server-side enforcement of the modules a SUPER_ADMIN disabled for an
 * organisation (lib/modules). Hiding a menu entry is only cosmetic: every page
 * of a module calls requireModulePage(), every API route of a module calls
 * rejectDisabledModule() first, and the routes authenticated by another
 * credential (Espace client, GPS tracking token) check the organisation of
 * that credential. The organisation always comes from the server-side
 * session or the signed credential - never from the request.
 */

export const MODULE_DISABLED_CODE = "MODULE_DISABLED";
export const MODULE_DISABLED_MESSAGE = "Ce module n'est pas activé pour votre organisation.";

export async function readDisabledModules(organizationId: string): Promise<ModuleKey[]> {
  return readOrganizationDisabledModules(prisma, organizationId);
}

function moduleDisabledResponse(modules: readonly ModuleKey[]) {
  return NextResponse.json(
    { message: MODULE_DISABLED_MESSAGE, code: MODULE_DISABLED_CODE, modules },
    { status: 403 },
  );
}

function refusal(request: Request, organizationId: string | null | undefined, disabledModules: readonly string[] | undefined) {
  const { pathname } = new URL(request.url);
  const decision = decideApiModuleAccess({ pathname, method: request.method, organizationId, disabledModules });
  if (decision.allowed) return null;
  if (decision.reason === "unmapped") {
    console.error(`[modules] route sans règle de module : ${request.method} ${pathname}`);
  }
  return moduleDisabledResponse(decision.modules);
}

/**
 * First lines of a module's route handler:
 *   const moduleRejection = await rejectDisabledModule(request);
 *   if (moduleRejection) return moduleRejection;
 * The module(s) come from the route's own URL (lib/modules/api-rules.ts), so a
 * handler can never claim another module. Returns null when the route is
 * allowed, or when there is no organisation session at all: the route's own
 * authentication then answers (401/403) exactly as before. A route missing
 * from the rules is refused (fail closed).
 */
export async function rejectDisabledModule(request: Request): Promise<NextResponse | null> {
  const user = await getCurrentSessionUser();
  return refusal(request, user?.organizationId, user?.disabledModules);
}

/**
 * Same check for a route authenticated by a signed credential that carries its
 * own organisation (the GPS tracking token): the organisation of that verified
 * credential, read fresh from the database.
 */
export async function rejectDisabledModuleForOrganization(
  request: Request,
  organizationId: string,
): Promise<NextResponse | null> {
  return refusal(request, organizationId, await readDisabledModules(organizationId));
}

/** For server code outside a route handler. */
export async function assertOrganizationModuleEnabled(organizationId: string, module: ModuleKey): Promise<void> {
  if (!(await isOrganizationModuleEnabled(organizationId, module))) {
    throw new AuthServiceError(MODULE_DISABLED_MESSAGE, 403);
  }
}

export async function isOrganizationModuleEnabled(organizationId: string, module: ModuleKey): Promise<boolean> {
  return isModuleEnabled(await readDisabledModules(organizationId), module);
}

/**
 * First line of a module's page (Server Component). A disabled module sends
 * the user to /module-indisponible instead of rendering anything; without an
 * organisation session the page's own checks apply unchanged.
 */
export async function requireModulePage(module: ModuleKey): Promise<void> {
  const user = await getCurrentSessionUser();
  if (!user?.organizationId) return;
  if (!isModuleEnabled(user.disabledModules, module)) {
    redirect(`/module-indisponible?module=${encodeURIComponent(module)}`);
  }
}
