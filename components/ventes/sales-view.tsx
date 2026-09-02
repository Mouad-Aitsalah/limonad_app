"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrdersTab } from "@/components/ventes/orders-tab";
import { SessionsTab } from "@/components/ventes/sessions-tab";
import { MonthsTab } from "@/components/ventes/months-tab";
import type { PosSessionDto, SaleHistoryOrdersPageDto, SalesMonthDto } from "@/types/operations-dto";

type SalesViewProps = {
  initialOrdersPage: SaleHistoryOrdersPageDto;
  sessions: PosSessionDto[];
  months: SalesMonthDto[];
};

export function SalesView({ initialOrdersPage, sessions, months }: SalesViewProps) {
  return (
    <Tabs defaultValue="orders" className="space-y-6">
      <TabsList variant="line" className="rounded-2xl border border-border bg-muted/30 p-1">
        <TabsTrigger value="orders">Commandes</TabsTrigger>
        <TabsTrigger value="sessions">Sessions</TabsTrigger>
        <TabsTrigger value="months">Mois</TabsTrigger>
      </TabsList>

      <TabsContent value="orders">
        <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <CardContent className="space-y-5">
            <div>
              <h2 className="font-heading text-lg font-semibold text-foreground">Commandes</h2>
              <p className="text-sm text-muted-foreground">
                Contient toutes les factures et tickets de vente : ventes normales,
                remboursements, paiements partiels et crédits.
              </p>
            </div>
            <OrdersTab initialPage={initialOrdersPage} />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="sessions">
        <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <CardContent className="space-y-5">
            <div>
              <h2 className="font-heading text-lg font-semibold text-foreground">Sessions</h2>
              <p className="text-sm text-muted-foreground">
                Contient les journées POS regroupées par session réelle sous la forme POS/1,
                POS/2, POS/3...
              </p>
            </div>
            <SessionsTab sessions={sessions} />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="months">
        <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
          <CardContent className="space-y-5">
            <div>
              <h2 className="font-heading text-lg font-semibold text-foreground">Mois</h2>
              <p className="text-sm text-muted-foreground">
                Contient les ventes regroupées par mois civil avec chiffre d&apos;affaires,
                remboursements et total net.
              </p>
            </div>
            <MonthsTab months={months} />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
