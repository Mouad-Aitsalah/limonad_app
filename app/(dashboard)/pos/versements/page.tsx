import type { Metadata } from "next";

import { CashDepositsView } from "@/components/cash-deposits/cash-deposits-view";
import { DepotRequiredNotice } from "@/components/pos/depot-required-notice";
import { getDepots, OperationsServiceError } from "@/lib/server/depots";
import { getCashDepositContext, getCashDepositHistory } from "@/lib/server/cash-deposits";
import { requireModulePage } from "@/lib/server/module-guard";

export const metadata: Metadata = {
  title: "Versements",
};

export default async function VersementsPage() {
  await requireModulePage("deposits");
  let context;
  let history;
  let depots;
  try {
    [context, history, depots] = await Promise.all([
      getCashDepositContext(),
      getCashDepositHistory({}),
      getDepots(),
    ]);
  } catch (error) {
    if (error instanceof OperationsServiceError) {
      return <DepotRequiredNotice message={error.message} />;
    }
    throw error;
  }

  return (
    <CashDepositsView initialContext={context} initialHistory={history} depots={depots} />
  );
}
