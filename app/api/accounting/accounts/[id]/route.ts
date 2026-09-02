import { NextResponse } from "next/server";

import { AuthServiceError } from "@/lib/server/auth";
import {
  setAccountingAccountActive,
  updateAccountingAccount,
} from "@/lib/server/accounting";
import { OperationsServiceError } from "@/lib/server/depots";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const csrfRejection = rejectUntrustedOrigin(request);
  if (csrfRejection) return csrfRejection;
  try {
    const { id } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;

    if (typeof body.isActive === "boolean" && !("code" in body) && !("name" in body) && !("type" in body)) {
      const account = await setAccountingAccountActive(id, body.isActive);
      return NextResponse.json({ account });
    }

    const account = await updateAccountingAccount(id, {
      code: String(body.code ?? ""),
      name: String(body.name ?? ""),
      type: String(body.type ?? "") as never,
      isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
    });
    return NextResponse.json({ account });
  } catch (error) {
    if (error instanceof AuthServiceError || error instanceof OperationsServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { message: "Impossible de mettre a jour le compte comptable." },
      { status: 500 },
    );
  }
}
