/**
 * In-memory stand-in for the six existing endpoints the data sync calls, used
 * by the counter-pos tests only (never imported by app code). It deliberately
 * returns the PRIVATE fields the real endpoints return (customer address /
 * e-mail / notes / balance, product cost price, raw base64 photos) so the tests
 * can prove they never reach local storage.
 */

import { computePriceTTC } from "@/lib/product-pricing";

export type FakeProduct = {
  id: string;
  reference: string;
  barcode?: string | null;
  name: string;
  /** HT sale price. */
  salePrice: number;
  taxRate: number;
  status: "ACTIVE" | "INACTIVE";
  imageUrl?: string | null;
  supplier?: { id: string; name: string } | null;
  purchasePrice?: number;
  /** Available at the user's depot. Undefined = no stock row at all. */
  stock?: number;
};

export type FakeCustomer = {
  id: string;
  code: string;
  displayCode: string;
  name: string;
  phone?: string | null;
  city?: string;
  type?: string;
  status: "ACTIVE" | "INACTIVE" | "BLOCKED";
  creditLimit?: number;
  creditLimitEnabled?: boolean;
  email?: string;
  address?: string;
  notes?: string;
  currentBalance?: number;
};

export type Injection =
  | { status: number; body?: unknown; contentType?: string }
  | { throw: Error }
  | { hang: true };

export class FakeServer {
  products: FakeProduct[] = [];
  customers: FakeCustomer[] = [];
  defaultCustomerId: string | null = null;
  bankAccounts = [{ id: "bank-1", code: "51410001", name: "Banque" }];
  identity: { name: string; tradeName: string | null; logoUrl: string | null } = {
    name: "Societe",
    tradeName: null,
    logoUrl: null,
  };
  /** The context carries at most this many products (real server: 500). */
  contextProductCap = 500;
  /** Real server: getPosCustomerPreload = 20 most recent + the default. */
  customerPreload = 20;

  /** What GET /api/auth/session says. `undefined` = the legitimate user. */
  sessionOverride: { id: string; role: string; organizationId: string | null } | null | undefined = undefined;
  contextUserIdOverride: string | undefined;
  identityIdOverride: string | undefined;
  /** Extra stock rows for OTHER locations, which the depot endpoint must not leak into this depot. */
  foreignStock: Array<{ productId: string; locationId: string; availableQuantity: number }> = [];

  readonly calls: Array<{ method: string; url: string; init?: RequestInit }> = [];
  private injections: Array<{ prefix: string; behavior: Injection; once: boolean }> = [];

  constructor(
    readonly organizationId: string,
    readonly userId: string = "user-1",
    readonly role: string = "cashier",
    readonly stockLocationId: string = "loc-1",
  ) {}

  /** Make requests whose URL starts with `prefix` misbehave. */
  inject(prefix: string, behavior: Injection, options: { once?: boolean } = {}): void {
    this.injections.push({ prefix, behavior, once: options.once ?? false });
  }

  clearInjections(): void {
    this.injections = [];
  }

  callsTo(prefix: string): number {
    return this.calls.filter((call) => call.url.startsWith(prefix)).length;
  }

  // Arrow property so it can be passed around as a plain function.
  fetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : input.url;
    this.calls.push({ method: init?.method ?? "GET", url, init });

    const injected = this.injections.findIndex((entry) => url.startsWith(entry.prefix));
    if (injected >= 0) {
      const entry = this.injections[injected];
      if (entry.once) this.injections.splice(injected, 1);
      const behavior = entry.behavior;
      if ("throw" in behavior) throw behavior.throw;
      if ("hang" in behavior) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      return new Response(
        typeof behavior.body === "string" ? behavior.body : JSON.stringify(behavior.body ?? {}),
        { status: behavior.status, headers: { "content-type": behavior.contentType ?? "application/json" } },
      );
    }

    const parsed = new URL(url, "http://local.test");
    const path = parsed.pathname;
    if (path === "/api/auth/session") return this.session();
    if (path === "/api/sales/context") return this.context();
    if (path === "/api/products/list") return this.productList(parsed.searchParams);
    if (path.startsWith("/api/stock/locations/")) {
      return this.stock(decodeURIComponent(path.slice("/api/stock/locations/".length)));
    }
    if (path === "/api/customers") return this.customerList();
    if (path === "/api/organization/identity") return this.identityResponse();
    return json(404, { message: "not found" });
  };

  private session(): Response {
    const user =
      this.sessionOverride === undefined
        ? { id: this.userId, role: this.role, organizationId: this.organizationId }
        : this.sessionOverride;
    return json(200, {
      user: user && { ...user, nom: "Nom", email: "user@example.com" },
    });
  }

  private activeProducts(): FakeProduct[] {
    return this.products.filter((product) => product.status === "ACTIVE");
  }

  private context(): Response {
    const active = this.activeProducts().sort((a, b) => a.name.localeCompare(b.name, "fr"));
    const truncated = active.length > this.contextProductCap;
    const products = (truncated ? active.slice(0, this.contextProductCap) : active).map((p) => ({
      id: p.id,
      reference: p.reference,
      barcode: p.barcode ?? null,
      name: p.name,
      imageUrl: p.imageUrl ?? null,
      salePriceHT: p.salePrice,
      salePriceTTC: computePriceTTC(p.salePrice, p.taxRate),
      taxRate: p.taxRate,
      availableQuantity: p.stock ?? 0,
      supplierId: p.supplier?.id ?? null,
      supplierName: p.supplier?.name ?? null,
      supplierLogoUrl: null,
    }));

    const activeCustomers = this.customers.filter((c) => c.status === "ACTIVE");
    const preload = [
      ...activeCustomers.filter((c) => c.id === this.defaultCustomerId),
      ...activeCustomers.filter((c) => c.id !== this.defaultCustomerId).slice(-this.customerPreload),
    ];

    return json(200, {
      context: {
        canSell: products.length > 0,
        user: { id: this.contextUserIdOverride ?? this.userId, name: "Caissier" },
        depot: { id: "depot-1", code: "DEP-01", name: "Depot 1" },
        stockLocation: { id: this.stockLocationId, code: "LOC-1", name: "Depot 1 - stock" },
        customers: preload.map((c) => this.fullCustomer(c)),
        defaultCustomerId: this.defaultCustomerId,
        products,
        productsTruncated: truncated,
        bankAccounts: this.bankAccounts,
      },
    });
  }

  private productList(params: URLSearchParams): Response {
    const status = params.get("status");
    const pageSize = Math.min(100, Number(params.get("pageSize") ?? 25));
    const cursor = params.get("cursor");
    // Real order: createdAt desc, id desc - i.e. newest first.
    const ordered = this.products
      .filter((product) => !status || product.status === status)
      .slice()
      .reverse();
    const start = cursor ? ordered.findIndex((product) => product.id === cursor) + 1 : 0;
    const rows = ordered.slice(start, start + pageSize + 1);
    const hasMore = rows.length > pageSize;
    const page = hasMore ? rows.slice(0, pageSize) : rows;
    return json(200, {
      items: page.map((p) => ({
        id: p.id,
        reference: p.reference,
        barcode: p.barcode ?? null,
        name: p.name,
        purchasePrice: p.purchasePrice ?? 4.2137, // the COST: must never be stored
        salePrice: p.salePrice,
        taxRate: p.taxRate,
        unit: "unite",
        minimumStock: 0,
        status: p.status,
        imageUrl: p.imageUrl ?? null,
        category: { id: "cat-1", name: "Boissons" },
        brand: null,
        supplier: p.supplier ?? null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      hasMore,
      totalCount: ordered.length,
    });
  }

  private stock(locationId: string): Response {
    const own =
      locationId === this.stockLocationId
        ? this.products
            .filter((p) => p.stock !== undefined)
            .map((p) => ({ productId: p.id, locationId, availableQuantity: p.stock as number, quantity: p.stock, minimumStock: 0 }))
        : [];
    return json(200, {
      location: { id: locationId },
      levels: [...own, ...this.foreignStock.map((row) => ({ ...row, quantity: row.availableQuantity }))],
    });
  }

  private fullCustomer(c: FakeCustomer) {
    return {
      id: c.id,
      code: c.code,
      displayCode: c.displayCode,
      name: c.name,
      phone: c.phone ?? null,
      city: c.city ?? "Casablanca",
      type: c.type ?? "RETAIL",
      status: c.status,
      creditLimit: c.creditLimit ?? 0,
      creditLimitEnabled: c.creditLimitEnabled ?? false,
      // private fields the real endpoints also send:
      email: c.email ?? "prive@example.com",
      address: c.address ?? "12 rue Secrete",
      notes: c.notes ?? "note confidentielle",
      currentBalance: c.currentBalance ?? 987.65,
      createdByUserId: "u0",
      createdByUserName: "Admin",
      creationOrigin: "ADMIN",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
  }

  private customerList(): Response {
    return json(200, { customers: this.customers.map((c) => this.fullCustomer(c)) });
  }

  private identityResponse(): Response {
    return json(200, {
      identity: { id: this.identityIdOverride ?? this.organizationId, ...this.identity },
    });
  }
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function makeProduct(n: number, overrides: Partial<FakeProduct> = {}): FakeProduct {
  return {
    id: `p${n}`,
    reference: `REF-${n}`,
    barcode: `6110000000${String(n).padStart(2, "0")}`,
    name: `Produit ${String(n).padStart(3, "0")}`,
    salePrice: 10,
    taxRate: 20,
    status: "ACTIVE",
    stock: 10 * n,
    supplier: { id: "sup-1", name: "Fournisseur Un" },
    ...overrides,
  };
}

export function makeCustomer(n: number, overrides: Partial<FakeCustomer> = {}): FakeCustomer {
  return {
    id: `c${n}`,
    code: `3421${n}`,
    displayCode: `3421/${n}`,
    name: `Client ${String(n).padStart(3, "0")}`,
    phone: `06000000${String(n).padStart(2, "0")}`,
    status: "ACTIVE",
    creditLimit: 1000,
    creditLimitEnabled: true,
    ...overrides,
  };
}

/** A server with `products` active products, `customers` customers, c1 default. */
export function seededServer(
  organizationId: string,
  counts: { products?: number; customers?: number } = {},
): FakeServer {
  const server = new FakeServer(organizationId);
  server.products = Array.from({ length: counts.products ?? 3 }, (_, i) => makeProduct(i + 1));
  server.customers = Array.from({ length: counts.customers ?? 2 }, (_, i) => makeCustomer(i + 1));
  server.defaultCustomerId = "c1";
  return server;
}
