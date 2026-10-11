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
import { useColumnLabels } from "@/components/table-labels/table-labels-provider";

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
  const label = useColumnLabels("payrollHistory");
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{label("number")}</TableHead>
            <TableHead>{label("date")}</TableHead>
            <TableHead>{label("period")}</TableHead>
            {showEmployee ? <TableHead>{label("employee")}</TableHead> : null}
            {showEmployee ? <TableHead>{label("employeeCode")}</TableHead> : null}
            <TableHead>{label("type")}</TableHead>
            <TableHead className="text-right">{label("amount")}</TableHead>
            <TableHead>{label("status")}</TableHead>
            <TableHead>{label("user")}</TableHead>
            <TableHead>{label("comment")}</TableHead>
            <TableHead>{label("journal")}</TableHead>
            {(onValidate || onCancel) ? <TableHead>{label("actions")}</TableHead> : null}
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
