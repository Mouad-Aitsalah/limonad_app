import { NextResponse } from "next/server";

import { DRIVER_GOODS_RETURNS_DISABLED_MESSAGE } from "@/lib/driver-returns-policy";
import { rejectDisabledModule } from "@/lib/server/module-guard";

// Goods returns are not available to drivers (lib/driver-returns-policy.ts): this
// route is closed for EVERY role. After the module check that every route starts
// with, it answers 403 without reading the body. Nothing here can create a credit
// note, move stock or post an accounting entry. The desk roles record returns from /avoirs.
export async function POST(request: Request) {
  const moduleRejection = await rejectDisabledModule(request);
  if (moduleRejection) return moduleRejection;
  return NextResponse.json({ message: DRIVER_GOODS_RETURNS_DISABLED_MESSAGE }, { status: 403 });
}
