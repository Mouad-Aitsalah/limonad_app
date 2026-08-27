import { redirect } from "next/navigation";

import { getDefaultRouteForRole } from "@/lib/auth/default-route";
import { getCurrentSessionUser } from "@/lib/server/auth";

export default async function HomePage() {
  const user = await getCurrentSessionUser();

  if (!user) {
    redirect("/login");
  }

  redirect(getDefaultRouteForRole(user.role));
}
