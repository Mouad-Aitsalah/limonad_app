import { NextResponse } from "next/server";

import { getDepots } from "@/lib/server/depots";

export async function GET() {
  try {
    return NextResponse.json({ depots: await getDepots() });
  } catch {
    return NextResponse.json(
      { message: "Impossible de charger les depots." },
      { status: 500 },
    );
  }
}
