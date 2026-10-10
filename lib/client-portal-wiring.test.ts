import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Espace Client wiring checks (source level): the separation between the
 * customer session and the staff ERP, CSRF on every state-changing route, and
 * the sale-path change kept strictly additive. Behaviour is covered by
 * lib/client-portal-rules.test.ts and lib/server/client-portal-core.test.ts.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

test("proxy: /client/login is public, /client/* needs the CLIENT cookie only, everything else still needs the staff cookie", () => {
  const proxy = code("../proxy.ts");
  assert.match(proxy, /const PUBLIC_PATHS = new Set<string>\(\["\/login", "\/client\/login"\]\);/);
  assert.match(proxy, /if \(pathname\.startsWith\("\/client\/"\)\) \{\s+if \(!request\.cookies\.has\(CLIENT_SESSION_COOKIE\)\)/);
  assert.match(proxy, /if \(!request\.cookies\.has\(SESSION_COOKIE\)\) \{\s+return NextResponse\.redirect\(new URL\("\/login"/);
  assert.match(proxy, /const CLIENT_SESSION_COOKIE = "comdis\.client-session";/);
  assert.match(proxy, /const SESSION_COOKIE = "comdis\.session";/);
});

test("the staff session never reads the client cookie, and client code never opens a staff session", () => {
  assert.equal(read("./server/auth.ts").includes("comdis.client-session"), false);
  for (const file of [
    "./server/client-auth.ts",
    "./server/client-portal-core.ts",
    "../app/api/client/login/route.ts",
    "../app/api/client/catalog/route.ts",
    "../app/api/client/orders/route.ts",
    "../app/client/catalog/page.tsx",
    "../app/client/cart/page.tsx",
    "../app/client/orders/page.tsx",
  ]) {
    assert.equal(/requireOrganizationUser|requireSessionUser/.test(code(file)), false, file);
  }
  // client data always scoped by the verified client session
  assert.match(code("../app/api/client/orders/route.ts"), /const client = await requireClient\(\);/);
  assert.match(code("../app/api/client/catalog/route.ts"), /getClientCatalogPage\(prisma, client\.organizationId/);
});

test("staff order routes use the staff session (POS roles) and never the client session", () => {
  const service = code("./server/customer-orders.ts");
  assert.match(service, /const STAFF_ROLES = \["admin", "depot_manager", "cashier"\] as const;/);
  assert.equal((service.match(/requireOrganizationUser\(\[\.\.\.STAFF_ROLES\]\)/g) ?? []).length, 4);
  assert.equal(service.includes("getCurrentClient"), false);
});

test("CSRF: every state-changing Espace Client / online-order route rejects untrusted origins", () => {
  for (const file of [
    "../app/api/client/login/route.ts",
    "../app/api/client/logout/route.ts",
    "../app/api/client/orders/route.ts",
    "../app/api/customer-orders/[id]/accept/route.ts",
    "../app/api/customer-orders/[id]/reject/route.ts",
  ]) {
    assert.match(code(file), /const csrfRejection = rejectUntrustedOrigin\(request\);\s+if \(csrfRejection\) return csrfRejection;/, file);
  }
});

test("client session cookie: httpOnly, SameSite=Lax, Secure in production, own secret, 8 h", () => {
  const auth = code("./server/client-auth.ts");
  assert.match(auth, /httpOnly: true,\s+sameSite: "lax",\s+secure: process\.env\.NODE_ENV === "production",/);
  const token = code("./server/client-session-token.ts");
  assert.match(token, /process\.env\.CLIENT_SESSION_SECRET/);
  assert.match(token, /throw new Error\("CLIENT_SESSION_SECRET n'est pas configure\."\)/);
  assert.match(read("./client-portal-rules.ts"), /CLIENT_SESSION_MAX_AGE_SECONDS = 8 \* 60 \* 60;/);
});

test("photo route: a client only gets photos of its own catalogue (ACTIVE + valid photo); staff path unchanged", () => {
  const route = code("../app/api/products/[id]/image/route.ts");
  assert.match(route, /const user = await requireOrganizationUser\(\["admin", "depot_manager", "cashier", "driver"\]\);/);
  assert.match(route, /if \(!\(await isClientCatalogProduct\(prisma, client\.organizationId, id\)\)\) \{/);
});

test("sale path (option A): customerOrderId is optional and only ever used inside the sale transaction", () => {
  const sales = code("./server/counter-sales.ts");
  assert.match(sales, /customerOrderId: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(64\)\.optional\(\),/);
  const createAt = sales.indexOf("const sale = await tx.sale.create(");
  const linkAt = sales.indexOf("if (parsed.data.customerOrderId) {");
  const paymentAt = sales.indexOf("const createdPayment =");
  assert.ok(createAt > 0 && linkAt > createAt && paymentAt > linkAt, "link right after the sale row, before payments/accounting");
  assert.match(sales, /if \(!link\.ok\) \{\s+throw new OperationsServiceError\(LINK_CUSTOMER_ORDER_MESSAGES\[link\.reason\], 409\);/);
  // schema field, the condition, and `customerOrderId: parsed.data.customerOrderId` (2) - nothing else
  assert.equal((sales.match(/customerOrderId/g) ?? []).length, 4, "schema + condition + argument only");
});

test("POS: the cart sends customerOrderId only while linked to an order; a new operation unlinks it", () => {
  const layout = code("../components/pos/pos-layout.tsx");
  assert.match(layout, /\.\.\.\(linkedCustomerOrder \? \{ customerOrderId: linkedCustomerOrder\.id \} : \{\}\),/);
  assert.match(layout, /function resetOperation\(\) \{\s+setCart\(\[\]\);\s+setLinkedCustomerOrder\(null\);/);
  assert.match(layout, /resetOperation\(\);\s+setCart\(order\.lines\.map\(\(line\) => \(\{ \.\.\.line, discountUnitAmount: 0 \}\)\)\);\s+setSelectedCustomer\(order\.customer\);\s+setLinkedCustomerOrder\(/);
  const hook = code("../components/pos/use-customer-order-pos.ts");
  assert.equal(/\/api\/sales/.test(hook), false, "opening an order never calls the sale API");
  assert.match(hook, /if \(latestRef\.current\.hasCartContent\(\)\) setPendingOrder\(order\);\s+else apply\(order\);/);
});

test("client cart: only {productId, quantity} is sent; prices shown come from the catalogue, totals from the POS formula", () => {
  const submit = code("../components/client/use-client-order-submit.ts");
  assert.match(submit, /lines: cart\.map\(\(line\) => \(\{ productId: line\.productId, quantity: line\.quantity \}\)\),/);
  assert.match(code("../components/client/client-cart-view.tsx"), /const total = estimateClientCartTotal\(cart\)\.totalTTC;/);
});

test("POS offline: a cart linked to an online order is refused offline FIRST, with an explicit message, cart and link untouched", () => {
  const layout = code("../components/pos/pos-layout.tsx");
  const body = layout.slice(layout.indexOf("async function saveOfflineSale("), layout.indexOf("async function confirmOperation("));
  const guardAt = body.indexOf("if (linkedCustomerOrder) {");
  assert.ok(guardAt > 0 && guardAt < body.indexOf("if (editSaleId || openPendingSale)"), "the link guard comes first");
  assert.match(body, /elle ne peut être facturée qu'avec une connexion au serveur\. Le panier est conservé/);
  const guard = body.slice(guardAt, body.indexOf("if (editSaleId || openPendingSale)"));
  assert.match(guard, /return false;/);
  assert.equal(/setLinkedCustomerOrder|resetOperation|setCart|deleteCart|createOfflineSale/.test(guard), false, "nothing is changed or created");
  // both ways into the offline sale (offline, and the network-failure fallback) go through saveOfflineSale
  assert.equal((layout.match(/await saveOfflineSale\(paidAmount\)/g) ?? []).length, 2);
});

test("POS reload: the link is restored with the cart through the isolated storage hook, and only after the cart is restored", () => {
  const layout = code("../components/pos/pos-layout.tsx");
  assert.match(
    layout,
    /useCustomerOrderLinkPersistence\(\{\s+scope: offline\.scope,\s+linked: linkedCustomerOrder,\s+setLinked: setLinkedCustomerOrder,\s+cartRestored,\s+cartLineCount: cart\.length,\s+selectedCustomerId: selectedCustomer\?\.id \?\? null,/,
  );
  assert.ok(layout.indexOf("useCustomerOrderLinkPersistence({") > layout.indexOf("const [cartRestored, setCartRestored]"));
  assert.match(layout, /\{linkedCustomerOrder && !openPendingSale \? \(\s+<CustomerOrderLinkBanner/);

  const hook = code("../components/pos/use-customer-order-link-persistence.ts");
  assert.match(hook, /if \(!organizationId \|\| !userId \|\| !cartRestored \|\| ready\) return;/, "restore waits for the cart, runs once");
  assert.match(hook, /resolveRestoredLink\(stored, latestRef\.current\)/);
  assert.match(hook, /linkAfterServerCheck\(link, answer\) === null/);
  assert.match(hook, /\/api\/customer-orders\/\$\{encodeURIComponent\(link\.id\)\}\/pos/);
  assert.match(hook, /if \(linked && cartLineCount === 0\) \{\s+setLinked\(null\);/, "a link whose cart is empty is dropped");
  assert.match(hook, /if \(linked\) saveCustomerOrderLink\(browserStorage\(\), linkScope, linked\);\s+else clearCustomerOrderLink\(browserStorage\(\), linkScope\);/);
  assert.equal(/\/api\/sales/.test(hook), false, "restoring a link never creates or changes a sale");
});

test("the link is removed exactly when the operation ends or the staff detaches it", () => {
  const layout = code("../components/pos/pos-layout.tsx");
  assert.match(layout, /function resetOperation\(\) \{\s+setCart\(\[\]\);\s+setLinkedCustomerOrder\(null\);/);
  assert.match(layout, /onDetach=\{\(\) => setLinkedCustomerOrder\(null\)\}/);
  // resetOperation is what ends a validated sale
  const confirm = layout.slice(layout.indexOf("async function confirmOperation("), layout.indexOf("async function prepareInvoice("));
  assert.match(confirm, /clearSlotReservation\(\);\s+resetOperation\(\);/);
});
