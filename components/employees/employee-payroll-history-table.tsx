"use client";

import Link from "next/link";

import { EmployeeTransactionStatusBadge } from "@/components/employees/employee-transaction-status-badge";
import { EmployeeTransactionTypeBadge } from "@/components/employees/employee-transaction-type-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPayrollPeriod } from "@/lib/employee-payroll";
import { formatCurrency } from "@/lib/utils";
import type { EmployeeTransactionDto } from "@/types/employees";

type EmployeePayrollHistoryTableProps = {
  transactions: EmployeeTransactionDto[];
  showEmployee?: boolean;
  onValidate?: (transactionId: string) => void;
  onCancel?: (transactionId: string) => void;
  busyId?: string | null;
};

export function EmployeePayrollHistoryTable({
  transactions,
  showEmployee = false,
  onValidate,
  onCancel,
  busyId = null,
}: EmployeePayrollHistoryTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>N°</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Periode</TableHead>
            {showEmployee ? <TableHead>Employe</TableHead> : null}
            {showEmployee ? <TableHead>Code employe</TableHead> : null}
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Montant</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead>Utilisateur</TableHead>
            <TableHead>Commentaire</TableHead>
            <TableHead>Journal</TableHead>
            {(onValidate || onCancel) ? <TableHead>Actions</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((transaction) => (
            <TableRow key={transaction.id}>
              <TableCell className="font-medium">{transaction.number}</TableCell>
              <TableCell>
                {new Date(transaction.transactionDate).toLocaleDateString("fr-FR")}
              </TableCell>
              <TableCell>
                {formatPayrollPeriod(transaction.payrollYear, transaction.payrollMonth)}
              </TableCell>
              {showEmployee ? <TableCell>{transaction.employeeName}</TableCell> : null}
              {showEmployee ? <TableCell>{transaction.employeeCode}</TableCell> : null}
              <TableCell>
                <EmployeeTransactionTypeBadge type={transaction.type} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(transaction.amount)}
              </TableCell>
              <TableCell>
                <EmployeeTransactionStatusBadge status={transaction.status} />
              </TableCell>
              <TableCell>{transaction.createdByUserName}</TableCell>
              <TableCell className="max-w-[280px] whitespace-normal text-sm text-muted-foreground">
                {transaction.comment ?? "-"}
              </TableCell>
              <TableCell>
                {transaction.accountingEntryNumber ? (
                  <Link
                    href="/comptabilite/journal"
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    {transaction.accountingEntryNumber}
                  </Link>
                ) : (
                  "-"
                )}
              </TableCell>
              {(onValidate || onCancel) ? (
                <TableCell>
                  {transaction.status === "DRAFT" ? (
                    <div className="flex flex-wrap gap-2">
                      {onValidate ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => onValidate(transaction.id)}
                          disabled={busyId === transaction.id}
                        >
                          Valider
                        </Button>
                      ) : null}
                      {onCancel ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onCancel(transaction.id)}
                          disabled={busyId === transaction.id}
                        >
                          Annuler
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    "-"
                  )}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
