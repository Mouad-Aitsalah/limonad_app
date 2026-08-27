import type { Metadata } from "next";

import { CashDepositsView } from "@/components/cash-deposits/cash-deposits-view";
import { getDepots } from "@/lib/server/depots";
import { getCashDepositContext, getCashDepositHistory } from "@/lib/server/cash-deposits";

export const metadata: Metadata = {
  title: "Versements",
};

export default async function VersementsPage() {
  const [context, history, depots] = await Promise.all([
    getCashDepositContext(),
    getCashDepositHistory({}),
    getDepots(),
  ]);

  return (
    <CashDepositsView initialContext={context} initialHistory={history} depots={depots} />
  );
}
