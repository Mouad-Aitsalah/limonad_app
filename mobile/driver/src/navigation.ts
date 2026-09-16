/**
 * PHASE 5A.2 - "17. NAVIGATION CLIENT". A plain state machine, no router:
 * only ever these four screens, and never a navigation to /driver,
 * /driver/pos or /driver/ventes (the Next app's own routes - unreachable
 * and irrelevant from this shell's origin).
 */
export type Screen = "HOME" | "LOGIN" | "OFFLINE_SALES" | "POS";
