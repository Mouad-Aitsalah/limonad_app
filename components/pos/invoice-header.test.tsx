import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { PageHeaderSlot, PageHeaderSlotProvider, PageHeaderSlotTarget } from "@/components/layout/page-header-slot";
import { InvoiceHeader } from "@/components/pos/invoice-header";
import { PosHeaderInfo } from "@/components/pos/pos-header-info";
import type { NetworkState } from "@/lib/offline/counter-pos";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const headerInfo = (networkState: NetworkState, invoiceLabel?: string) =>
  renderToStaticMarkup(
    <PosHeaderInfo
      networkState={networkState}
      pendingCount={0}
      failedCount={0}
      syncStatus={{ running: false, lastRun: null }}
      onSyncNow={() => {}}
      invoiceLabel={invoiceLabel}
    />,
  );

test("POS header: N° Facture and Heure side by side - no user, no date, shown at every width", () => {
  const markup = renderToStaticMarkup(<InvoiceHeader invoiceLabel="75/2026" />);
  assert.match(text(markup), /^N° Facture 75\/2026 Heure \d{2}:\d{2}$/);
  assert.doesNotMatch(text(markup), /Utilisateur|Date|\d{2}\/\d{2}\/\d{4}/);
  // two sibling segments (a fragment), no card of their own, no desktop-only wrapper
  assert.match(markup, /^<p data-testid="pos-invoice-number"[^>]*>[\s\S]*<\/p><p data-testid="pos-invoice-time"[^>]*>[\s\S]*<\/p>$/);
  assert.doesNotMatch(markup, /hidden|lg:flex|rounded/);
  assert.match(text(renderToStaticMarkup(<InvoiceHeader />)), /^N° Facture - Heure/);
});

test("POS header block: En ligne | N° Facture | Heure on one horizontal row with vertical separators", () => {
  const markup = headerInfo("ONLINE", "75/2026");
  assert.match(text(markup), /^En ligne N° Facture 75\/2026 Heure \d{2}:\d{2}$/);
  const block = markup.match(/^<div data-testid="pos-header-info" class="([^"]+)">/);
  assert.ok(block, "one block");
  for (const token of ["flex", "flex-wrap", "items-center", "divide-x", "rounded-2xl", "border", "bg-muted/40"]) {
    assert.ok(block[1].split(" ").includes(token), token);
  }
  assert.doesNotMatch(block[1], /flex-col|grid/, "not stacked");
  // order: status, then invoice number, then time
  const status = markup.indexOf('data-testid="pos-network-status"');
  const number = markup.indexOf('data-testid="pos-invoice-number"');
  const time = markup.indexOf('data-testid="pos-invoice-time"');
  assert.ok(status > 0 && status < number && number < time);
});

test("POS header block offline: the status label stays short, the explanation is kept as tooltip + screen-reader text", () => {
  const markup = headerInfo("OFFLINE", "75/2026");
  assert.match(markup, /data-state="OFFLINE"/);
  assert.match(markup, /title="Hors connexion — les ventes sont gardées sur ce poste et envoyées à la reconnexion\."/);
  assert.match(markup, /<span class="sr-only">— les ventes sont gardées sur ce poste et envoyées à la reconnexion\.<\/span>/);
  assert.match(headerInfo("SERVER_UNREACHABLE"), /Serveur injoignable — mode hors connexion/);
});

test("POS: the block is rendered in the page header, no longer in the cash-desk content; the session user stays in the POS data", () => {
  const layout = read("./pos-layout.tsx");
  assert.match(
    layout,
    /<PageHeaderSlot\s+fallback=\{\s*<div className="flex justify-end" data-testid="pos-top-info">\s*\{headerInfo\}\s*<\/div>\s*\}\s*>\s*\{headerInfo\}\s*<\/PageHeaderSlot>/,
  );
  assert.match(layout, /const headerInfo = \(\s*<PosHeaderInfo\s+networkState=\{offline\.networkState\}[\s\S]*?invoiceLabel=\{activeInvoiceLabel\}\s*\/>\s*\);/);
  assert.doesNotMatch(layout, /<OfflineStatusBar|<InvoiceHeader/, "no second copy in the content");
  assert.match(layout, /cashierName: context\.user\.name,/, "the ticket still names the cashier");
  assert.match(layout, /createdByUserName: context\.user\.name,/);
});

test("page header: title + date on the left, the page's slot on the same row at the right, assistant + profile untouched", () => {
  const header = read("../layout/header.tsx");
  assert.match(
    header,
    /<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<div className="flex min-w-\[min\(15\.5rem,100%\)\] flex-1 flex-col gap-1">\s*<h1 className="font-heading text-\[1\.8rem\] leading-tight font-semibold tracking-\[-0\.04em\] break-words text-\[var\(--text-primary\)\] sm:text-\[2\.3rem\]">\s*\{currentLabel\}\s*<\/h1>\s*<p className="text-sm capitalize text-\[var\(--text-secondary\)\]" suppressHydrationWarning>\s*\{today\}\s*<\/p>\s*<\/div>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<PageHeaderSlotTarget kind="desktop" className="ml-auto flex max-w-full justify-end empty:hidden" \/>\s*<\/div>/,
  );
  // the right-hand block (assistant + profile) is untouched and never shrinks
  assert.match(header, /<div className="hidden shrink-0 items-center gap-3 lg:flex">\s*<AssistantLauncherButton \/>\s*<UserMenu/);

  const mobile = read("../mobile/mobile-header.tsx");
  assert.match(mobile, /<PageHeaderSlotTarget kind="mobile" className="mobile-safe-x px-4 pb-2 empty:hidden" \/>\s*<\/header>/);

  const shell = read("../layout/dashboard-shell.tsx");
  assert.match(shell, /<PageHeaderSlotProvider>\s*<Header \/>\s*<MobileHeader \/>[\s\S]*?<\/main>\s*<\/PageHeaderSlotProvider>/);
});

test("page header slot: fallback in place without a shared header, empty hidden targets otherwise", () => {
  // no provider (offline POS shell): the page keeps its block in its content
  assert.equal(
    renderToStaticMarkup(<PageHeaderSlot fallback={<span>fallback</span>}><span>header</span></PageHeaderSlot>),
    "<span>fallback</span>",
  );
  assert.equal(renderToStaticMarkup(<PageHeaderSlotTarget kind="desktop" />), "");
  // inside the shell: the targets are empty (hidden by empty:hidden) until a page portals into them
  assert.equal(
    renderToStaticMarkup(
      <PageHeaderSlotProvider>
        <PageHeaderSlotTarget kind="desktop" className="empty:hidden" />
        <PageHeaderSlotTarget kind="mobile" className="empty:hidden" />
        <PageHeaderSlot fallback={<span>fallback</span>}>
          <span>header</span>
        </PageHeaderSlot>
      </PageHeaderSlotProvider>,
    ),
    '<div class="empty:hidden" data-page-header-slot="desktop"></div><div class="empty:hidden" data-page-header-slot="mobile"></div>',
  );
});
