import assert from "node:assert/strict";
import { test } from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

import { TableLabelsProvider } from "@/components/table-labels/table-labels-provider";
import { AuthContext, type AuthContextValue } from "@/hooks/use-auth";
import { UsersTable } from "@/components/users/users-table";
import { InvoiceLinesTable } from "@/components/ventes/invoice-lines-table";
import { ProductsTable } from "@/components/produits/products-table";
import type { TableLabels } from "@/lib/table-labels/labels";
import type { User } from "@/types/user";

const headers = (markup: string) =>
  [...markup.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((match) => match[1].replace(/<[^>]+>/g, "").trim()).filter(Boolean);

const auth: AuthContextValue = {
  currentUser: null,
  isLoading: false,
  login: async () => ({ success: false, error: "test" }),
  logout: async () => {},
  refreshSession: async () => {},
};

/** Renders `node` as if it were on `pathname`, with the organisation's `labels`. */
function onPage(pathname: string | null, labels: TableLabels | null, node: React.ReactNode) {
  const content = labels ? <TableLabelsProvider initialLabels={labels}>{node}</TableLabelsProvider> : node;
  return renderToStaticMarkup(
    <AuthContext.Provider value={auth}>
      <PathnameContext.Provider value={pathname}>{content}</PathnameContext.Provider>
    </AuthContext.Provider>,
  );
}

const user: User = {
  id: "u1",
  nom: "Sara Alaoui",
  email: "sara@example.test",
  telephone: "",
  role: "cashier",
  actif: true,
  organizationId: "org",
  organizationName: "Org",
  depotId: null,
  depotName: null,
  derniereConnexion: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  driver: null,
};
const usersTable = <UsersTable users={[user]} onUserUpdated={() => {}} />;
const linesTable = <InvoiceLinesTable lines={[]} />;

test("no configuration: every table shows exactly its former labels (with or without provider)", () => {
  const expected = ["Nom", "Email", "Rôle", "Statut", "Dernière connexion", "Actions"];
  assert.deepEqual(headers(onPage(null, null, usersTable)), expected);
  assert.deepEqual(headers(onPage("/utilisateurs", {}, usersTable)), expected);
  assert.deepEqual(headers(onPage("/ventes/journalieres", {}, linesTable)), ["Produit", "Prix TTC", "Qté", "Total TTC"]);
});

test("the organisation's labels replace the defaults on their page; the other columns keep theirs", () => {
  const labels: TableLabels = { users: { users: { email: "Courriel", lastLogin: "Vu le" } } };
  assert.deepEqual(headers(onPage("/utilisateurs", labels, usersTable)), ["Nom", "Courriel", "Rôle", "Statut", "Vu le", "Actions"]);
  const products = onPage("/produits", { products: { products: { reference: "Réf. article", actions: "Gérer" } } }, <ProductsTable products={[]} onView={() => {}} onEdit={() => {}} onToggleStatus={() => {}} />);
  // empty product list: no table rendered, nothing to rename - and no crash
  assert.equal(products.includes("<th"), false);
});

test("independent per page: the same invoice-lines table renamed on Factures journalières only", () => {
  const labels: TableLabels = {
    dailyInvoices: { invoiceLines: { quantity: "Quantité vendue" } },
    salesArchive: { invoiceLines: { total: "Montant" } },
  };
  assert.deepEqual(headers(onPage("/ventes/journalieres", labels, linesTable)), ["Produit", "Prix TTC", "Quantité vendue", "Total TTC"]);
  assert.deepEqual(headers(onPage("/ventes", labels, linesTable)), ["Produit", "Prix TTC", "Qté", "Montant"]);
  // a page without a configuration (or outside the registry) = defaults
  assert.deepEqual(headers(onPage("/pos", labels, linesTable)), ["Produit", "Prix TTC", "Qté", "Total TTC"]);
  // a label stored for the users page never leaks into another page
  assert.deepEqual(headers(onPage("/ventes", { users: { users: { email: "Courriel" } } }, usersTable)), ["Nom", "Email", "Rôle", "Statut", "Dernière connexion", "Actions"]);
});
