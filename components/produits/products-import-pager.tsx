"use client";

import { Button } from "@/components/ui/button";
import { buildPageWindow, formatImportCount } from "@/lib/products-import-shared";

type ProductsImportPagerProps = {
  page: number;
  pageCount: number;
  /** 1-based first / last line shown, and the size of the (filtered) list. */
  from: number;
  to: number;
  totalRows: number;
  onPageChange: (page: number) => void;
};

/**
 * Pager of the import preview table: "Page 1 / 50", the lines shown, and
 * ← Précédent  1 2 3 4 5 … 50  Suivant →. Display only: the global counters
 * above the table never depend on the page.
 */
export function ProductsImportPager({ page, pageCount, from, to, totalRows, onPageChange }: ProductsImportPagerProps) {
  return (
    <nav aria-label="Pagination de l'aperçu" className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground">
        Page {formatImportCount(page)} / {formatImportCount(pageCount)} · lignes {formatImportCount(from)}–
        {formatImportCount(to)} sur {formatImportCount(totalRows)}
      </p>
      {pageCount > 1 ? (
        <div className="flex flex-wrap items-center gap-1">
          <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            ← Précédent
          </Button>
          {buildPageWindow(page, pageCount).map((button, index) =>
            button === "gap" ? (
              <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-muted-foreground">
                …
              </span>
            ) : (
              <Button
                key={button}
                type="button"
                variant={button === page ? "default" : "outline"}
                size="sm"
                aria-current={button === page ? "page" : undefined}
                aria-label={`Page ${button}`}
                onClick={() => onPageChange(button)}
              >
                {button}
              </Button>
            ),
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
          >
            Suivant →
          </Button>
        </div>
      ) : null}
    </nav>
  );
}
