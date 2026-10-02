const KPIS = [
  { x: 118, label: "Ventes", value: "128 450", color: "#00966D" },
  { x: 214, label: "Achats", value: "74 210", color: "#2f6fd6" },
  { x: 310, label: "Clients", value: "1 284", color: "#f2a33a" },
  { x: 406, label: "Stock", value: "9 640", color: "#7a5cd6" },
] as const;

const PRODUCTS = [
  { name: "Eau minérale 1.5L", qty: "420", w: 82 },
  { name: "Jus d'orange 1L", qty: "315", w: 64 },
  { name: "Soda cola 33cl", qty: "260", w: 52 },
  { name: "Huile de table 5L", qty: "148", w: 34 },
] as const;

const FONT = "system-ui, sans-serif";

/**
 * Decorative laptop on a store counter showing an ERP dashboard (sidebar, KPI
 * cards, sales chart, product list, stock levels). Pure inline SVG: no image
 * request, scales with its container, hidden from assistive technologies.
 */
export function LoginDashboardIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 640 380" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="lp-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e4e9f1" />
          <stop offset="1" stopColor="#aab4c4" />
        </linearGradient>
        <linearGradient id="lp-counter" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b5a86" />
          <stop offset="1" stopColor="#1c3760" />
        </linearGradient>
        <linearGradient id="lp-chart" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#00966D" stopOpacity=".35" />
          <stop offset="1" stopColor="#00966D" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="lp-shadow" cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#000" stopOpacity=".35" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* counter + shadow */}
      <rect x="0" y="322" width="640" height="58" fill="url(#lp-counter)" opacity=".9" />
      <rect x="0" y="322" width="640" height="3" fill="#fff" opacity=".25" />
      <ellipse cx="320" cy="334" rx="270" ry="14" fill="url(#lp-shadow)" />

      {/* screen frame */}
      <rect x="86" y="20" width="468" height="292" rx="16" fill="#0d1b30" />
      <rect x="94" y="28" width="452" height="276" rx="10" fill="#f4f7fb" />

      {/* sidebar */}
      <rect x="94" y="28" width="52" height="276" rx="10" fill="#102B4E" />
      <rect x="104" y="40" width="32" height="10" rx="3" fill="#00966D" />
      {[66, 88, 110, 132, 154, 176].map((y, i) => (
        <g key={y}>
          <rect x="106" y={y} width="8" height="8" rx="2" fill="#fff" opacity={i === 0 ? 0.95 : 0.45} />
          <rect x="119" y={y + 2} width="17" height="4" rx="2" fill="#fff" opacity={i === 0 ? 0.8 : 0.3} />
        </g>
      ))}

      {/* top bar */}
      <rect x="152" y="36" width="388" height="18" rx="6" fill="#fff" />
      <rect x="160" y="42" width="70" height="6" rx="3" fill="#cdd6e3" />
      <circle cx="528" cy="45" r="6" fill="#00966D" />

      {/* KPI cards */}
      {KPIS.map((kpi) => (
        <g key={kpi.label}>
          <rect x={kpi.x + 34} y="62" width="88" height="42" rx="7" fill="#fff" />
          <rect x={kpi.x + 34} y="62" width="3" height="42" rx="1.5" fill={kpi.color} />
          <text x={kpi.x + 44} y="77" fontSize="8" fill="#6b7a90" fontFamily={FONT}>
            {kpi.label}
          </text>
          <text x={kpi.x + 44} y="94" fontSize="13" fontWeight="700" fill="#102B4E" fontFamily={FONT}>
            {kpi.value}
          </text>
        </g>
      ))}

      {/* sales chart */}
      <rect x="152" y="112" width="232" height="184" rx="8" fill="#fff" />
      <text x="162" y="128" fontSize="9" fontWeight="700" fill="#102B4E" fontFamily={FONT}>
        Ventes mensuelles
      </text>
      {[150, 180, 210, 240, 270].map((y) => (
        <line key={y} x1="162" x2="374" y1={y} y2={y} stroke="#e8edf4" strokeWidth="1" />
      ))}
      <path
        d="M162 262 L190 244 L218 252 L246 216 L274 224 L302 188 L330 196 L358 160 L374 150 L374 276 L162 276 Z"
        fill="url(#lp-chart)"
      />
      <polyline
        points="162,262 190,244 218,252 246,216 274,224 302,188 330,196 358,160 374,150"
        fill="none"
        stroke="#00966D"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <polyline
        points="162,270 190,262 218,264 246,246 274,250 302,232 330,236 358,214 374,208"
        fill="none"
        stroke="#2f6fd6"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity=".7"
      />

      {/* product list */}
      <rect x="392" y="112" width="148" height="112" rx="8" fill="#fff" />
      <text x="402" y="128" fontSize="9" fontWeight="700" fill="#102B4E" fontFamily={FONT}>
        Produits les plus vendus
      </text>
      {PRODUCTS.map((product, i) => (
        <g key={product.name}>
          <rect x="402" y={138 + i * 21} width="14" height="14" rx="4" fill="#e6f5ef" />
          <text x="422" y={148 + i * 21} fontSize="7.5" fill="#33425a" fontFamily={FONT}>
            {product.name}
          </text>
          <text x="530" y={148 + i * 21} fontSize="7.5" fontWeight="700" textAnchor="end" fill="#102B4E" fontFamily={FONT}>
            {product.qty}
          </text>
        </g>
      ))}

      {/* stock levels */}
      <rect x="392" y="232" width="148" height="64" rx="8" fill="#fff" />
      <text x="402" y="247" fontSize="9" fontWeight="700" fill="#102B4E" fontFamily={FONT}>
        Niveau de stock
      </text>
      {PRODUCTS.slice(0, 3).map((product, i) => (
        <g key={product.name}>
          <rect x="402" y={256 + i * 12} width="128" height="6" rx="3" fill="#e8edf4" />
          <rect
            x="402"
            y={256 + i * 12}
            width={product.w * 1.4}
            height="6"
            rx="3"
            fill={i === 2 ? "#f2a33a" : "#00966D"}
          />
        </g>
      ))}

      {/* laptop base */}
      <path d="M60 312 H580 L604 326 Q606 332 598 332 H42 Q34 332 36 326 Z" fill="url(#lp-body)" />
      <rect x="270" y="312" width="100" height="6" rx="3" fill="#8793a6" opacity=".7" />
    </svg>
  );
}
