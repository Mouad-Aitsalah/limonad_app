import { redirect } from "next/navigation";

import { HomeRedirect } from "@/components/auth/home-redirect";
import { getCurrentSessionUser } from "@/lib/server/auth";

export default async function HomePage() {
  const user = await getCurrentSessionUser();

  if (!user) {
    redirect("/login");
  }

  return <HomeRedirect role={user.role} />;
}
