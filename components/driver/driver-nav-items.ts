import {
  Home,
  Route,
  ShoppingCart,
  Store,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

export type DriverNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export const driverNavItems: DriverNavItem[] = [
  { label: "Accueil", href: "/driver", icon: Home },
  { label: "Mon stock", href: "/driver/stock", icon: Warehouse },
  { label: "Mes ventes", href: "/driver/ventes", icon: ShoppingCart },
  { label: "Point de vente", href: "/driver/pos", icon: Store },
  { label: "Mes clients", href: "/driver/clients", icon: Users },
  { label: "Ma tournée", href: "/driver/tournee", icon: Route },
];
