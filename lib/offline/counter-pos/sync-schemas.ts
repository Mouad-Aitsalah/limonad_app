"use client";

/**
 * COUNTER POS - validation of what the server sends during a data sync.
 *
 * The server's answers are parsed, not trusted: a malformed payload is
 * refused BEFORE anything is written, so a bad response can never poison the
 * local snapshot. zod strips unknown keys by default, which also means the
 * private customer fields the existing endpoints send (address, e-mail, tax
 * ids, notes, GPS, balance) and the product COST price are dropped here and
 * never reach IndexedDB.
 *
 * Endpoints (all existing, none modified):
 *   GET /api/auth/session              identity guard
 *   GET /api/sales/context             POS context (+ first 500 products)
 *   GET /api/products/list             full active catalogue, cursor pages
 *   GET /api/stock/locations/{id}      stock of the depot
 *   GET /api/customers                 all customers
 *   GET /api/organization/identity     organization name / logo
 */

import { z } from "zod";

import { computePriceTTC } from "@/lib/product-pricing";
import type { DriverPosProductDto } from "@/types/operations-dto";

const id = z.string().min(1);
const optionalString = z.string().nullish();

export const sessionResponseSchema = z.object({
  user: z
    .object({
      id,
      role: z.string(),
      organizationId: z.string().nullable(),
    })
    .nullable(),
});

const namedRef = z.object({ id, code: z.string(), name: z.string() });

/** A product as getCounterPosContext returns it (DriverPosProductDto). */
const contextProductSchema = z.object({
  id,
  reference: z.string(),
  barcode: optionalString,
  name: z.string().min(1),
  imageUrl: optionalString,
  salePriceHT: z.number().min(0),
  salePriceTTC: z.number().min(0),
  taxRate: z.number().min(0).max(100),
  availableQuantity: z.number(),
  supplierId: optionalString,
  supplierName: optionalString,
  supplierLogoUrl: optionalString,
  priceToken: z.string().optional(),
});

/** The customer fields the snapshot keeps - and nothing else. */
export const customerSchema = z.object({
  id,
  code: z.string(),
  displayCode: z.string(),
  name: z.string().min(1),
  phone: z.string().nullish().transform((value) => value ?? null),
  city: z.string(),
  type: z.string(),
  status: z.string(),
  creditLimit: z.number(),
  creditLimitEnabled: z.boolean(),
});

export const contextResponseSchema = z.object({
  context: z.object({
    canSell: z.boolean(),
    message: z.string().nullish().transform((value) => value ?? undefined),
    user: z.object({ id, name: z.string() }),
    depot: namedRef,
    stockLocation: namedRef,
    customers: z.array(customerSchema),
    defaultCustomerId: z.string().nullable(),
    products: z.array(contextProductSchema),
    productsTruncated: z.boolean(),
    bankAccounts: z.array(namedRef),
  }),
});

/** A product as GET /api/products/list returns it (ProductDto). Only the
 *  selling fields are read - never purchasePrice (the cost). */
const listProductSchema = z.object({
  id,
  reference: z.string(),
  barcode: optionalString,
  name: z.string().min(1),
  salePrice: z.number().min(0),
  taxRate: z.number().min(0).max(100),
  status: z.string(),
  imageUrl: optionalString,
  supplier: z.object({ id, name: z.string() }).nullish(),
});

export const productPageSchema = z.object({
  items: z.array(listProductSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  totalCount: z.number(),
});

export const stockLocationResponseSchema = z.object({
  levels: z.array(
    z.object({
      productId: id,
      locationId: id,
      availableQuantity: z.number(),
    }),
  ),
});

export const customersResponseSchema = z.object({ customers: z.array(customerSchema) });

export const identityResponseSchema = z.object({
  identity: z.object({
    id,
    name: z.string().min(1),
    tradeName: optionalString,
    logoUrl: optionalString,
  }),
});

export type ListProduct = z.infer<typeof listProductSchema>;

/**
 * A catalogue-page product as the POS product shape. Same rule as
 * getCounterPosContext: HT is the sale price, TTC is computePriceTTC(HT, tax),
 * and a product with no stock row at the depot has 0 available.
 */
export function posProductFromListProduct(
  product: ListProduct,
  availableByProduct: Map<string, number>,
): DriverPosProductDto {
  return {
    id: product.id,
    reference: product.reference,
    barcode: product.barcode ?? null,
    name: product.name,
    imageUrl: product.imageUrl ?? null,
    salePriceHT: product.salePrice,
    salePriceTTC: computePriceTTC(product.salePrice, product.taxRate),
    taxRate: product.taxRate,
    availableQuantity: availableByProduct.get(product.id) ?? 0,
    supplierId: product.supplier?.id ?? null,
    supplierName: product.supplier?.name ?? null,
    supplierLogoUrl: null,
  };
}

/** "path.to.field: message" for the first problem - enough to debug a contract
 *  drift without dumping the payload (which may hold customer data). */
export function describeSchemaIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "invalid payload";
  const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
  return `${path}: ${issue.message}`;
}
