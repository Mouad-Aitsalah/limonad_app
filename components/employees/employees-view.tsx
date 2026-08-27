"use client";

import * as React from "react";
import Link from "next/link";

import { EmployeeDialog } from "@/components/employees/employee-dialog";
import { EmployeeStatusBadge } from "@/components/employees/employee-status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import type { EmployeeDto, EmployeesSummaryDto } from "@/types/employees";

type EmployeesViewProps = {
  initialEmployees: EmployeeDto[];
  initialSummary: EmployeesSummaryDto;
};

export function EmployeesView({ initialEmployees, initialSummary }: EmployeesViewProps) {
  const [employees, setEmployees] = React.useState(initialEmployees);
  const [summary, setSummary] = React.useState(initialSummary);
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<"all" | "ACTIVE" | "INACTIVE">("all");
  const [editingEmployee, setEditingEmployee] = React.useState<EmployeeDto | null>(null);

  const filteredEmployees = employees.filter((employee) => {
    const haystack = normalize(
      [
        employee.employeeCode,
        employee.fullName,
        employee.phone ?? "",
        employee.advanceAccount?.code ?? "",
        employee.advanceAccount?.name ?? "",
        employee.salaryAccount?.code ?? "",
        employee.salaryAccount?.name ?? "",
      ].join(" "),
    );
    const query = normalize(search);
    const matchesSearch = query.length === 0 || haystack.includes(query);
    const matchesStatus = status === "all" || employee.status === status;
    return matchesSearch && matchesStatus;
  });

  async function refreshEmployees() {
    const response = await fetch("/api/employees", { cache: "no-store" });
    const payload = (await response.json()) as {
      items?: EmployeeDto[];
      summary?: EmployeesSummaryDto;
      message?: string;
    };
    if (!response.ok || !payload.items || !payload.summary) {
      throw new Error(payload.message ?? "Impossible de recharger les employes.");
    }
    setEmployees(payload.items);
    setSummary(payload.summary);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Employes</h1>
          <p className="text-sm text-muted-foreground">
            Annuaire des employes, avec code metier, salaire mensuel et comptes comptables.
          </p>
        </div>

        <EmployeeDialog onSaved={refreshEmployees} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total employes" value={String(summary.totalCount)} />
        <SummaryCard label="Actifs" value={String(summary.activeCount)} />
        <SummaryCard label="Paie mensuelle" value={formatCurrency(summary.monthlyPayroll)} />
        <SummaryCard label="Avances du mois" value={formatCurrency(summary.monthlyAdvances)} />
      </div>

      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-5">
          <div className="grid gap-3 lg:grid-cols-[1fr_220px]">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher par code, nom, telephone ou compte..."
            />
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as "all" | "ACTIVE" | "INACTIVE")
              }
              className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none"
            >
              <option value="all">Tous les statuts</option>
              <option value="ACTIVE">Actifs</option>
              <option value="INACTIVE">Inactifs</option>
            </select>
          </div>

          <p className="text-sm text-muted-foreground">
            {filteredEmployees.length} employe{filteredEmployees.length > 1 ? "s" : ""}
          </p>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code employe</TableHead>
                  <TableHead>Nom complet</TableHead>
                  <TableHead>Date embauche</TableHead>
                  <TableHead className="text-right">Salaire</TableHead>
                  <TableHead>Telephone</TableHead>
                  <TableHead>Code compte avance</TableHead>
                  <TableHead>Nom compte avance</TableHead>
                  <TableHead>Code compte salaire</TableHead>
                  <TableHead>Nom compte salaire</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEmployees.map((employee) => (
                  <TableRow key={employee.id}>
                    <TableCell className="font-medium">{employee.employeeCode}</TableCell>
                    <TableCell>{employee.fullName}</TableCell>
                    <TableCell>
                      {employee.hireDate
                        ? new Date(employee.hireDate).toLocaleDateString("fr-FR")
                        : "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {employee.salary != null ? formatCurrency(employee.salary) : "-"}
                    </TableCell>
                    <TableCell>{employee.phone ?? "-"}</TableCell>
                    <TableCell>{employee.advanceAccount?.code ?? "-"}</TableCell>
                    <TableCell>{employee.advanceAccount?.name ?? "-"}</TableCell>
                    <TableCell>{employee.salaryAccount?.code ?? "-"}</TableCell>
                    <TableCell>{employee.salaryAccount?.name ?? "-"}</TableCell>
                    <TableCell>
                      <EmployeeStatusBadge status={employee.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingEmployee(employee)}
                        >
                          Modifier
                        </Button>
                        <Link
                          href={`/employes/${employee.id}`}
                          className={buttonVariants({ size: "sm" })}
                        >
                          Detail
                        </Link>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <EmployeeDialog
        employee={editingEmployee}
        open={editingEmployee !== null}
        onOpenChange={(open) => {
          if (!open) setEditingEmployee(null);
        }}
        onSaved={refreshEmployees}
      />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
      <CardContent>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}
