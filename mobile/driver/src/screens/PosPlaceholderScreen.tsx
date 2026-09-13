import { styles } from "../ui/styles";

type PosPlaceholderScreenProps = {
  onBack: () => void;
};

/**
 * PHASE 5A.2 - "12. ACTIONS ACCUEIL": the real POS (DriverPosView, receipts,
 * sharing, auto-sync) is explicitly deferred to Phase 5A.3 - this is only a
 * placeholder so the "Point de vente" button leads somewhere coherent.
 */
export function PosPlaceholderScreen({ onBack }: PosPlaceholderScreenProps) {
  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>Point de vente</h1>
      </header>
      <section style={styles.card}>
        <p style={styles.muted}>POS bientot disponible dans le shell (Phase 5A.3).</p>
      </section>
      <button type="button" style={styles.secondaryButton} onClick={onBack}>
        Retour
      </button>
    </main>
  );
}
