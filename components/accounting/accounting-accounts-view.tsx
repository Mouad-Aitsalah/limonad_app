"use client";

import * as React from "react";
import Link from "next/link";
import { Pencil, Plus, Power, Search } from "lucide-react";
import { toast } from "sonner";

import { accountingAccountTypeLabels } from "@/lib/accounting";
import type {
  AccountingAccountDto,
  AccountingAccountInput,
  AccountingAccountType,
} from "@/types/accounting";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const accountTypes = Object.keys(accountingAccountTypeLabels) as AccountingAccountType[];

type AccountFormState = {
  code: string;
  name: string;
  type: AccountingAccountType;
  isActive: boolean;
};

const defaultFormState: AccountFormState = {
  code: "",
  name: "",
  type: "REVENUE",
  isActive: true,
};

type AccountingAccountsViewProps = {
  initialAccounts: AccountingAccountDto[];
  canManage: boolean;
};

export function AccountingAccountsView({
  initialAccounts,
  canManage,
}: AccountingAccountsViewProps) {
  const [accounts, setAccounts] = React.useState(initialAccounts);
  const [search, setSearch] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<"all" | AccountingAccountType>("all");
  const [statusFilter, setStatusFilter] = React.useState<"all" | "active" | "inactive">("all");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [editingAccount, setEditingAccount] = React.useState<AccountingAccountDto | null>(null);
  const [form, setForm] = React.useState<AccountFormState>(defaultFormState);

  const filteredAccounts = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return accounts.filter((account) => {
      const matchesSearch =
        query.length === 0 ||
        account.code.toLowerCase().includes(query) ||
        account.name.toLowerCase().includes(query);
      const matchesType = typeFilter === "all" || account.type === typeFilter;
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && account.isActive) ||
        (statusFilter === "inactive" && !account.isActive);

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [accounts, search, typeFilter, statusFilter]);

  function openCreateDialog() {
    setEditingAccount(null);
    setForm(defaultFormState);
    setDialogOpen(true);
  }

  function openEditDialog(account: AccountingAccountDto) {
    setEditingAccount(account);
    setForm({
      code: account.code,
      name: account.name,
      type: account.type,
      isActive: account.isActive,
    });
    setDialogOpen(true);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;

    setSaving(true);
    try {
      const payload: AccountingAccountInput = {
        code: form.code,
        name: form.name,
        type: form.type,
        isActive: form.isActive,
      };
      const response = await fetch(
        editingAccount ? `/api/accounting/accounts/${editingAccount.id}` : "/api/accounting/accounts",
        {
          method: editingAccount ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const result = (await response.json()) as {
        account?: AccountingAccountDto;
        message?: string;
      };
      if (!response.ok || !result.account) {
        toast.error(result.message ?? "Impossible d'enregistrer le compte.");
        return;
      }
      const savedAccount = result.account;

      setAccounts((prev) => {
        if (editingAccount) {
          return prev.map((account) =>
            account.id === savedAccount.id ? savedAccount : account,
          );
        }
        return [savedAccount, ...prev].sort((a, b) => a.code.localeCompare(b.code));
      });
      toast.success(editingAccount ? "Compte mis a jour." : "Compte cree.");
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(account: AccountingAccountDto) {
    if (!canManage) return;

    const response = await fetch(`/api/accounting/accounts/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !account.isActive }),
    });
    const result = (await response.json()) as {
      account?: AccountingAccountDto;
      message?: string;
    };
    if (!response.ok || !result.account) {
      toast.error(result.message ?? "Impossible de changer le statut du compte.");
      return;
    }

    setAccounts((prev) =>
      prev.map((item) => (item.id === result.account?.id ? result.account : item)),
    );
    toast.success(
      result.account.isActive ? "Compte active." : "Compte desactive.",
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative w-full lg:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher un code ou un compte..."
              className="pl-9"
            />
          </div>

          <select
            value={typeFilter}
            onChange={(event) =>
              setTypeFilter(event.target.value as "all" | AccountingAccountType)
            }
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none"
          >
            <option value="all">Tous les types</option>
            {accountTypes.map((type) => (
              <option key={type} value={type}>
                {accountingAccountTypeLabels[type]}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as "all" | "active" | "inactive")
            }
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none"
          >
            <option value="all">Tous les statuts</option>
            <option value="active">Actifs</option>
            <option value="inactive">Inactifs</option>
          </select>
        </div>

        {canManage && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger render={<Button type="button" size="lg" onClick={openCreateDialog} />}>
              <Plus className="h-4 w-4" />
              Ajouter
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>
                  {editingAccount ? "Modifier le compte" : "Nouveau compte comptable"}
                </DialogTitle>
                <DialogDescription>
                  Le plan comptable reste centralise et reutilisable par tout le module.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="account-code">Code</Label>
                    <Input
                      id="account-code"
                      value={form.code}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, code: event.target.value }))
                      }
                      placeholder="7111"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="account-name">Nom du compte</Label>
                    <Input
                      id="account-name"
                      value={form.name}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, name: event.target.value }))
                      }
                      placeholder="Ventes"
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="account-type">Type</Label>
                    <select
                      id="account-type"
                      value={form.type}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          type: event.target.value as AccountingAccountType,
                        }))
                      }
                      className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none"
                    >
                      {accountTypes.map((type) => (
                        <option key={type} value={type}>
                          {accountingAccountTypeLabels[type]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-border p-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Compte actif</p>
                    <p className="text-xs text-muted-foreground">
                      Disponible pour les ecritures comptables et les parametres.
                    </p>
                  </div>
                  <Switch
                    checked={form.isActive}
                    onCheckedChange={(checked) =>
                      setForm((prev) => ({ ...prev, isActive: checked }))
                    }
                  />
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDialogOpen(false)}
                    disabled={saving}
                  >
                    Annuler
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? "Enregistrement..." : "Enregistrer"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {filteredAccounts.length} compte{filteredAccounts.length > 1 ? "s" : ""}
          </p>
        </div>

        <div className="p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Nom du compte</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Mouvements</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAccounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="font-medium">{account.code}</TableCell>
                  <TableCell>{account.name}</TableCell>
                  <TableCell>{accountingAccountTypeLabels[account.type]}</TableCell>
                  <TableCell>
                    <Badge variant={account.isActive ? "secondary" : "outline"}>
                      {account.isActive ? "Actif" : "Inactif"}
                    </Badge>
                  </TableCell>
                  <TableCell>{account.movementCount}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/comptabilite/journal?account=${account.id}`}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        Voir mouvements
                      </Link>
                      {canManage && (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            aria-label={`Modifier ${account.name}`}
                            onClick={() => openEditDialog(account)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant={account.isActive ? "ghost" : "secondary"}
                            size="icon-sm"
                            aria-label={
                              account.isActive
                                ? `Desactiver ${account.name}`
                                : `Activer ${account.name}`
                            }
                            onClick={() => handleToggle(account)}
                          >
                            <Power className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
