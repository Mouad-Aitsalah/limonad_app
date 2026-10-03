import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { driverOwnCustomersWhere, isCustomerOwnedByDriver } from "@/lib/driver-customer-scope";

type FakeCustomer = {
  id: string;
  code: string;
  name: string;
  createdByDriverId: string | null;
  creationOrigin: "ADMIN" | "DRIVER";
};

const CHRKI = "driver-chrki";
const YASSINE = "driver-yassine";

const customers: FakeCustomer[] = [
  { id: "c1", code: "3421/1", name: "Epicerie Atlas", createdByDriverId: CHRKI, creationOrigin: "DRIVER" },
  { id: "c2", code: "3421/2", name: "Cafe Atlas", createdByDriverId: CHRKI, creationOrigin: "DRIVER" },
  { id: "c3", code: "3421/3", name: "Superette Yassine", createdByDriverId: YASSINE, creationOrigin: "DRIVER" },
  { id: "c4", code: "3421/4", name: "Client admin", createdByDriverId: null, creationOrigin: "ADMIN" },
  { id: "c5", code: "3421/5", name: "Ancien client sans createur", createdByDriverId: null, creationOrigin: "DRIVER" },
];

/** In-memory evaluation of exactly the filter the server applies to a driver session. */
function listFor(driverId: string | null, search = ""): FakeCustomer[] {
  const where = driverOwnCustomersWhere(driverId);
  const q = search.trim().toLowerCase();
  return customers.filter(
    (customer) =>
      customer.createdByDriverId === where.createdByDriverId &&
      (!q || customer.name.toLowerCase().includes(q) || customer.code.toLowerCase().includes(q)),
  );
}

test("a driver sees only the customers he created (Chrki / Yassine example)", () => {
  assert.deepEqual(listFor(CHRKI).map((c) => c.id), ["c1", "c2"]);
  assert.deepEqual(listFor(YASSINE).map((c) => c.id), ["c3"]);
});

test("customers without a driver creator (admin-created, legacy) are never attributed to a driver", () => {
  for (const driverId of [CHRKI, YASSINE]) {
    const ids = listFor(driverId).map((c) => c.id);
    assert.equal(ids.includes("c4"), false, "admin-created customer");
    assert.equal(ids.includes("c5"), false, "legacy customer without creator");
  }
});

test("a driver cannot reach another driver's customer, even by exact name or number", () => {
  assert.deepEqual(listFor(CHRKI, "Superette Yassine"), []);
  assert.deepEqual(listFor(CHRKI, "3421/3"), []);
  assert.deepEqual(listFor(YASSINE, "3421/1"), []);
});

test("search by name and by customer number still works inside the driver's own customers", () => {
  assert.deepEqual(listFor(CHRKI, "atlas").map((c) => c.id), ["c1", "c2"]);
  assert.deepEqual(listFor(CHRKI, "cafe").map((c) => c.id), ["c2"]);
  assert.deepEqual(listFor(CHRKI, "3421/1").map((c) => c.id), ["c1"]);
});

test("a driver session without a driver profile sees nothing (never an unfiltered list)", () => {
  for (const driverId of [null, undefined, ""]) {
    const where = driverOwnCustomersWhere(driverId);
    assert.equal(where.createdByDriverId, "__never__");
    assert.deepEqual(listFor(driverId as string | null), []);
    assert.equal(isCustomerOwnedByDriver(customers[0], driverId), false);
  }
});

test("in-memory twin agrees with the query filter", () => {
  for (const driverId of [CHRKI, YASSINE, null]) {
    assert.deepEqual(
      customers.filter((c) => isCustomerOwnedByDriver(c, driverId)).map((c) => c.id),
      listFor(driverId).map((c) => c.id),
    );
  }
});

// ---------------------------------------------------------------------------
// Wiring: the filter is applied in the SERVER queries, nowhere only in the UI
// ---------------------------------------------------------------------------
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("search and number lookup scope a DRIVER session in the query; other roles are unfiltered", () => {
  const customersTs = read("./server/customers.ts");
  const search = customersTs.slice(customersTs.indexOf("export async function searchCustomers"), customersTs.indexOf("export async function resolveCustomerByNumber"));
  const lookup = customersTs.slice(customersTs.indexOf("export async function resolveCustomerByNumber"), customersTs.indexOf("const POS_CUSTOMER_PRELOAD_LIMIT"));
  for (const [name, body] of [["searchCustomers", search], ["resolveCustomerByNumber", lookup]] as const) {
    assert.match(body, /currentUser\.role === "driver" \? driverOwnCustomersWhere\(currentUser\.driverId\) : \{\}/, `${name}: driver scoped, admins/cashiers get {}`);
    assert.equal(/creationOrigin: "ADMIN"/.test(body), false, `${name}: no admin-origin customers for a driver`);
  }
  assert.match(search, /AND: \[\s*driverScope,/, "text search is AND-ed with the driver scope, never replacing it");
});

test("driver POS preload lists only own customers; the tour deep-link guarantee keeps its wider rule", () => {
  const sales = read("./server/driver-sales.ts");
  const context = sales.slice(sales.indexOf("getPosCustomerPreload({"), sales.indexOf("listActiveBankAccountOptions(prisma, user.organizationId)"));
  assert.match(context, /extraWhere: driverOwnCustomersWhere\(driver\.id\)/);
  assert.match(context, /guaranteeWhere: \{\s*OR: \[\{ creationOrigin: "ADMIN" \}, \{ createdByDriverId: driver\.id \}\]/);
  const customersTs = read("./server/customers.ts");
  assert.match(customersTs, /\.\.\.guaranteeWhere \}/);
  assert.match(customersTs, /where: \{ organizationId, status: "ACTIVE", \.\.\.extraWhere \}/, "the recent list still uses extraWhere");
});

test("offline cache source: ?scope=own returns only own customers; the default list is unchanged", () => {
  const driverCustomers = read("./server/driver-customers.ts");
  assert.match(driverCustomers, /options\.ownOnly\s*\?\s*driverOwnCustomersWhere\(user\.driverId\)/);
  assert.match(driverCustomers, /: \{ OR: \[\{ creationOrigin: "ADMIN" as const \}, \{ createdByDriverId: user\.driverId \}\] \}/);
  const route = read("../app/api/driver/customers/route.ts");
  assert.match(route, /searchParams\.get\("scope"\) === "own"/);
  const mobile = read("../mobile/driver/src/lib/driver-pos-data-source.ts");
  assert.match(mobile, /\/api\/driver\/customers\?scope=own/);
});

test("customers created by a driver are tied to his driver id (so the filter can find them)", () => {
  const driverCustomers = read("./server/driver-customers.ts");
  assert.ok((driverCustomers.match(/createdByDriverId: user\.driverId,/g) ?? []).length >= 2, "full form + quick add");
  assert.ok((driverCustomers.match(/creationOrigin: "DRIVER"/g) ?? []).length >= 2);
});

test("other screens keep their own rules: driver Clients page and tours are not narrowed", () => {
  const driverCustomers = read("./server/driver-customers.ts");
  assert.match(driverCustomers, /function driverAccessWhere[\s\S]*?creationOrigin: "ADMIN" \}, \{ createdByDriverId: driverId \}/);
  const tour = read("./server/driver-tour.ts");
  assert.match(tour, /OR: \[\{ creationOrigin: "ADMIN" as const \}, \{ createdByDriverId: driverId \}\]/);
  const posLayout = read("../components/pos/pos-layout.tsx");
  assert.equal(/driver-customer-scope/.test(posLayout), false, "counter POS untouched");
});
