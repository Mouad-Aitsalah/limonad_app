import {
  Package,
  ShoppingCart,
  TriangleAlert,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type Kpi = {
  id: string;
  label: string;
  value: string;
  change: number;
  trend: "up" | "down";
  icon: LucideIcon;
};

export const kpis: Kpi[] = [
  {
    id: "revenue",
    label: "Chiffre d'affaires",
    value: "128 450 DH",
    change: 12.4,
    trend: "up",
    icon: Wallet,
  },
  {
    id: "sales-today",
    label: "Ventes aujourd'hui",
    value: "42",
    change: 8.2,
    trend: "up",
    icon: ShoppingCart,
  },
  {
    id: "products",
    label: "Produits",
    value: "1 284",
    change: 3.1,
    trend: "up",
    icon: Package,
  },
  {
    id: "stock-alerts",
    label: "Alertes de stock",
    value: "7",
    change: 2,
    trend: "down",
    icon: TriangleAlert,
  },
];

export type SalesTrendPoint = {
  date: string;
  ventes: number;
};

export const salesTrend: SalesTrendPoint[] = [
  { date: "30/06", ventes: 3400 },
  { date: "01/07", ventes: 3834 },
  { date: "02/07", ventes: 4151 },
  { date: "03/07", ventes: 4282 },
  { date: "04/07", ventes: 4236 },
  { date: "05/07", ventes: 4085 },
  { date: "06/07", ventes: 3927 },
  { date: "07/07", ventes: 3837 },
  { date: "08/07", ventes: 3833 },
  { date: "09/07", ventes: 3868 },
  { date: "10/07", ventes: 3859 },
  { date: "11/07", ventes: 3738 },
  { date: "12/07", ventes: 3490 },
  { date: "13/07", ventes: 3170 },
  { date: "14/07", ventes: 2884 },
  { date: "15/07", ventes: 2742 },
  { date: "16/07", ventes: 2808 },
  { date: "17/07", ventes: 3073 },
  { date: "18/07", ventes: 3454 },
  { date: "19/07", ventes: 3834 },
  { date: "20/07", ventes: 4113 },
  { date: "21/07", ventes: 4250 },
  { date: "22/07", ventes: 4273 },
  { date: "23/07", ventes: 4258 },
  { date: "24/07", ventes: 4287 },
  { date: "25/07", ventes: 4398 },
  { date: "26/07", ventes: 4564 },
  { date: "27/07", ventes: 4705 },
  { date: "28/07", ventes: 4727 },
  { date: "29/07", ventes: 4573 },
];

export type CategorySales = {
  category: string;
  value: number;
  color: string;
};

export const categorySales: CategorySales[] = [
  { category: "Alimentaire", value: 38, color: "var(--chart-1)" },
  { category: "Boissons", value: 24, color: "var(--chart-2)" },
  { category: "Hygiène", value: 16, color: "var(--chart-3)" },
  { category: "Électroménager", value: 13, color: "var(--chart-4)" },
  { category: "Autres", value: 9, color: "var(--chart-5)" },
];

export type TopProduct = {
  id: string;
  name: string;
  category: string;
  unitsSold: number;
  revenue: string;
};

export const topProducts: TopProduct[] = [
  { id: "p1", name: "Huile de tournesol 5L", category: "Alimentaire", unitsSold: 842, revenue: "18 320 DH" },
  { id: "p2", name: "Eau minérale 1.5L (pack 6)", category: "Boissons", unitsSold: 765, revenue: "12 940 DH" },
  { id: "p3", name: "Lessive liquide 3L", category: "Hygiène", unitsSold: 611, revenue: "10 480 DH" },
  { id: "p4", name: "Riz basmati 25kg", category: "Alimentaire", unitsSold: 498, revenue: "9 870 DH" },
  { id: "p5", name: "Café moulu 1kg", category: "Alimentaire", unitsSold: 452, revenue: "8 215 DH" },
];

export type StockAlert = {
  id: string;
  product: string;
  sku: string;
  quantity: number;
  threshold: number;
  severity: "critique" | "faible";
};

export const stockAlerts: StockAlert[] = [
  { id: "a1", product: "Huile de tournesol 5L", sku: "ALM-0231", quantity: 4, threshold: 20, severity: "critique" },
  { id: "a2", product: "Sucre en poudre 1kg", sku: "ALM-0187", quantity: 9, threshold: 30, severity: "critique" },
  { id: "a3", product: "Savon liquide mains 500ml", sku: "HYG-0092", quantity: 14, threshold: 25, severity: "faible" },
  { id: "a4", product: "Jus d'orange 1L (pack 6)", sku: "BOI-0144", quantity: 18, threshold: 25, severity: "faible" },
];

export type RecentSale = {
  id: string;
  client: string;
  date: string;
  amount: string;
  status: "payé" | "en attente" | "annulé";
};

export const recentSales: RecentSale[] = [
  { id: "V-10482", client: "Épicerie El Fath", date: "29/07/2026", amount: "2 340 DH", status: "payé" },
  { id: "V-10481", client: "Superette Al Amal", date: "29/07/2026", amount: "1 180 DH", status: "en attente" },
  { id: "V-10480", client: "Grossiste Ben Ali", date: "28/07/2026", amount: "5 620 DH", status: "payé" },
  { id: "V-10479", client: "Magasin Nour", date: "28/07/2026", amount: "890 DH", status: "annulé" },
  { id: "V-10478", client: "Épicerie El Fath", date: "27/07/2026", amount: "3 105 DH", status: "payé" },
];

