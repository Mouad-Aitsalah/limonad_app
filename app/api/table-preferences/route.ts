import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { OperationsServiceError } from "@/lib/server/depots";
import { reportUnexpected } from "@/lib/server/report-error";
import {
  getMyTablePreferences,
  resetMyTablePreference,
  saveMyTablePreference,
} from "@/lib/server/table-preferences";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  // Error class / code only (never the message, which could embed SQL details).
  console.error("[table-preferences] unexpected failure", {
    name: error instanceof Error ? error.name : typeof error,
    code: (error as { code?: unknown } | null)?.code,
  });
  reportUnexpected(error, { route: "/api/table-preferences", area: "table-preferences" });
  return NextResponse.json({ message: fallback }, { status: 500 });
}

/**
 * The signed-in ADMIN's own column preferences (lib/table-columns):
 *   GET                         -> { preferences: { [table]: { order, hidden } } }
 *   PUT { table, order, hidden } -> saves ONE table
 *   DELETE ?table=<key>          -> back to the default columns for that table
 * 403 for every other role. Scoped to the session's user AND organisation only.
 */
export async function GET() {
  try {
    return NextResponse.json({ preferences: await getMyTablePreferences() });
  } catch (error) {
    return errorResponse(error, "Impossible de charger les préférences de colonnes.");
  }
}

export async function PUT(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const body = await request.json().catch(() => null);
    return NextResponse.json(await saveMyTablePreference(body));
  } catch (error) {
    return errorResponse(error, "Impossible d'enregistrer les colonnes.");
  }
}

export async function DELETE(request: Request) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const table = new URL(request.url).searchParams.get("table");
    return NextResponse.json(await resetMyTablePreference(table));
  } catch (error) {
    return errorResponse(error, "Impossible de restaurer les colonnes.");
  }
}
