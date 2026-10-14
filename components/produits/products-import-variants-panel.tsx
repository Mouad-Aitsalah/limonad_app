"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import type { ServerVariantGroup } from "@/lib/products-import-client";
import { formatImportCount } from "@/lib/products-import-shared";
import { variantDefaultsHint, type VariantDefaultsForm } from "@/lib/products-import-variant-ui";

export type VariantSupplierOption = { id: string; name: string };

type Props = {
  /** How the header-less file was read, in plain words. */
  columnsNotice?: string;
  suppliers: readonly VariantSupplierOption[];
  suppliersError?: string;
  form: VariantDefaultsForm;
  /** The last supplier / VAT sent to the server (null = none yet). */
  applied: { supplierName: string; taxRate: number } | null;
  loading: boolean;
  /** Groups as the server grouped them (null while unknown). */
  groups: readonly ServerVariantGroup[] | null;
  onChange: (form: VariantDefaultsForm) => void;
  onApply: () => void;
};

/** Groups listed at most; blocked ones come first. */
export const VARIANT_GROUPS_LISTED = 50;

/**
 * The variants part of the import page: the VAT / supplier of the NEW products
 * (explicitly confirmed - never assumed) and the groups, one per parent product.
 * The write is atomic per group; it needs the supplier and the VAT confirmed here.
 */
export function ProductsImportVariantsPanel({ columnsNotice, suppliers, suppliersError, form, applied, loading, groups, onChange, onApply }: Props) {
  const hint = variantDefaultsHint(form);
  const blockedGroups = (groups ?? []).filter((group) => group.blocked);
  const listed = [...(groups ?? [])].sort((a, b) => Number(b.blocked) - Number(a.blocked)).slice(0, VARIANT_GROUPS_LISTED);

  return (
    <section className="space-y-4 rounded-xl border px-4 py-4 text-sm" data-import="variants">
      <div className="space-y-1">
        <h2 className="font-heading text-base font-semibold">Fichier avec variantes</h2>
        {columnsNotice ? <p className="text-muted-foreground">{columnsNotice}</p> : null}
        <p className="text-muted-foreground">
          Chaque ligne est une variante : un produit à part entière (référence, code-barres, prix et stock propres), regroupé sous son produit
          parent. Si une variante d&apos;un groupe est invalide, <span className="font-medium text-foreground">tout le groupe est bloqué</span> :
          aucune de ses variantes n&apos;est importée.
        </p>
        <p className="text-muted-foreground" data-import="variants-atomic">
          Un groupe est écrit en une seule transaction : toutes ses variantes ou aucune. Une variante inchangée ne déclenche aucune écriture, et le stock du
          fichier est une cible (jamais une addition).
        </p>
      </div>

      <div className="space-y-3 rounded-lg bg-muted/40 px-3 py-3" data-import="variants-defaults">
        <p className="font-medium">Pour les NOUVEAUX produits seulement</p>
        <p className="text-muted-foreground">
          Ce format n&apos;a ni fournisseur ni TVA. Les produits qui existent déjà gardent les leurs : ils ne sont jamais modifiés par ces valeurs.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">Fournisseur</span>
            <select
              className="h-9 min-w-56 rounded-md border bg-background px-2 text-sm"
              value={form.supplierId}
              onChange={(event) => onChange({ ...form, supplierId: event.currentTarget.value, confirmed: false })}
              data-import="variants-supplier"
            >
              <option value="">— Choisir —</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">TVA (%)</span>
            <input
              className="h-9 w-24 rounded-md border bg-background px-2 text-sm tabular-nums"
              inputMode="decimal"
              value={form.taxRateText}
              onChange={(event) => onChange({ ...form, taxRateText: event.currentTarget.value, confirmed: false })}
              data-import="variants-tax"
            />
          </label>
        </div>
        {suppliersError ? <p className="text-destructive">{suppliersError}</p> : null}
        <label className="flex items-center gap-2 font-medium">
          <input
            type="checkbox"
            className="size-4"
            checked={form.confirmed}
            onChange={(event) => onChange({ ...form, confirmed: event.currentTarget.checked })}
            data-import="variants-confirm"
          />
          Je confirme ce fournisseur et cette TVA pour les nouveaux produits
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" disabled={hint !== null || loading} onClick={onApply} data-import="variants-apply">
            Appliquer et recalculer
          </Button>
          {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
          {applied ? (
            <span className="text-xs text-emerald-700" data-import="variants-applied">
              Appliqué : {applied.supplierName}, TVA {applied.taxRate} %
            </span>
          ) : (
            <span className="text-xs text-amber-700">Non confirmé : les nouveaux produits restent en erreur tant que ce n&apos;est pas fait.</span>
          )}
        </div>
      </div>

      {groups ? (
        <div className="space-y-2" data-import="variants-groups">
          <p>
            <span className="font-medium">{formatImportCount(groups.length)}</span> produit(s) parent
            {blockedGroups.length > 0 ? (
              <>
                {" · "}
                <span className="font-medium text-destructive">{formatImportCount(blockedGroups.length)} groupe(s) bloqué(s)</span>
              </>
            ) : (
              " · aucun groupe bloqué"
            )}
          </p>
          {listed.length > 0 ? (
            <div className="max-h-72 overflow-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-2 text-left">Produit parent</th>
                    <th className="p-2 text-left">Catégorie</th>
                    <th className="p-2 text-right">Variantes</th>
                    <th className="p-2 text-right">Nouvelles</th>
                    <th className="p-2 text-right">À mettre à jour</th>
                    <th className="p-2 text-right">Inchangées</th>
                    <th className="p-2 text-left">Groupe</th>
                  </tr>
                </thead>
                <tbody>
                  {listed.map((group, index) => (
                    <tr key={`${group.parentName}-${group.categoryName ?? ""}-${index}`} className="border-t align-top" data-blocked={group.blocked ? "true" : "false"}>
                      <td className="p-2">{group.parentName}</td>
                      <td className="p-2">{group.categoryName ?? "—"}</td>
                      <td className="p-2 text-right tabular-nums">{group.variants}</td>
                      <td className="p-2 text-right tabular-nums">{group.new}</td>
                      <td className="p-2 text-right tabular-nums">{group.update}</td>
                      <td className="p-2 text-right tabular-nums">{group.unchanged}</td>
                      <td className="p-2">
                        {group.blocked ? (
                          <span className="text-destructive">
                            Bloqué — {group.reason}
                            {group.blockedRows > 0 ? ` (${group.blockedRows} variante(s) valide(s) bloquée(s))` : ""}
                          </span>
                        ) : (
                          <span className="text-emerald-700">Prêt</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {groups.length > listed.length ? (
            <p className="text-xs text-muted-foreground">
              {formatImportCount(listed.length)} premiers groupes affichés (les bloqués d&apos;abord) sur {formatImportCount(groups.length)}.
            </p>
          ) : null}
        </div>
      ) : loading ? (
        <p className="text-muted-foreground">Regroupement en cours...</p>
      ) : null}
    </section>
  );
}
