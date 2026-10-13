import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { InvoiceHeader } from "@/components/pos/invoice-header";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test("POS top right: only N° Facture and Heure are displayed - no user, no date", () => {
  const markup = renderToStaticMarkup(<InvoiceHeader invoiceLabel="75/2026" />);
  const rendered = text(markup);
  assert.match(rendered, /^N° Facture 75\/2026 Heure \d{2}:\d{2}$/);
  assert.doesNotMatch(rendered, /Utilisateur|Date|\d{2}\/\d{2}\/\d{4}/);
  // desktop only, as before (phones go straight to products / cart)
  assert.match(markup, /class="hidden [^"]*lg:flex"/);
  assert.match(text(renderToStaticMarkup(<InvoiceHeader />)), /^N° Facture - Heure/);
});

test("POS top right: network status + invoice info form one group aligned right on desktop; the session user stays in the POS data", () => {
  const layout = read("./pos-layout.tsx");
  assert.match(
    layout,
    /<div className="flex flex-wrap items-center gap-3 lg:justify-end" data-testid="pos-top-info">\s*<OfflineStatusBar[\s\S]*?\/>\s*<InvoiceHeader invoiceLabel=\{activeInvoiceLabel\} \/>/,
  );
  assert.match(layout, /cashierName: context\.user\.name,/, "the ticket still names the cashier");
  assert.match(layout, /createdByUserName: context\.user\.name,/);
});

test("page header: the title on the first line, the date right under it, same sizes and colours", () => {
  const header = read("../layout/header.tsx");
  assert.match(
    header,
    /<div className="mt-2 flex min-w-0 flex-col gap-1">\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<h1 className="font-heading text-\[1\.8rem\] leading-tight font-semibold tracking-\[-0\.04em\] break-words text-\[var\(--text-primary\)\] sm:text-\[2\.3rem\]">\s*\{currentLabel\}\s*<\/h1>\s*<p className="text-sm capitalize text-\[var\(--text-secondary\)\]" suppressHydrationWarning>\s*\{today\}\s*<\/p>/,
  );
  assert.doesNotMatch(header, /flex-wrap items-end gap-x-4/, "no longer side by side");
  // the right-hand block (assistant + profile) is untouched and never shrinks
  assert.match(header, /<div className="hidden shrink-0 items-center gap-3 lg:flex">\s*<AssistantLauncherButton \/>\s*<UserMenu/);
});
