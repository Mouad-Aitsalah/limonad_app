"use client";

import * as React from "react";
import { toast } from "sonner";

import type { AiPosDraftForPosDto } from "@/types/ai-pos-draft-dto";
import type { DriverPosProductDto } from "@/types/operations-dto";

/**
 * Opens a cart prepared by the AI assistant (/pos?aiDraft=<id>) in the POS's
 * OWN cart - there is no second cart. Flow:
 *   1. GET /api/pos/ai-draft/<id>: the server re-validates everything (author,
 *      organisation, OPEN, not expired, products still sellable, customer).
 *   2. Its products are registered in the POS known products first (so a
 *      product beyond the 500 preloaded ones is resolvable, never dropped).
 *   3. Cart empty -> apply directly. Cart not empty -> ask (Remplacer / Annuler),
 *      never overwrite nor merge silently.
 *   4. POST .../apply marks the draft APPLIED (once - a second click or tab
 *      gets "déjà ouvert"), and only then the POS fills its cart.
 * Nothing here creates a sale: the user validates it with the normal button.
 */
export function useAiPosDraft(options: {
  draftId: string | null;
  /** The locally saved cart has been restored (so "is the cart empty" is known). */
  ready: boolean;
  /** Why a draft can't be opened right now (edit mode, offline), or null. */
  blockedReason: string | null;
  hasCartContent: () => boolean;
  registerProducts: (products: DriverPosProductDto[]) => void;
  fillCart: (draft: AiPosDraftForPosDto) => void;
  clearDraftParam: () => void;
}) {
  const { draftId, ready } = options;
  const latestRef = React.useRef(options);
  React.useEffect(() => {
    latestRef.current = options;
  });
  const handledRef = React.useRef<string | null>(null);
  const [pendingDraft, setPendingDraft] = React.useState<AiPosDraftForPosDto | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Once the link has been handled its parameter is removed from the URL:
  // forget it then, so clicking the same "Ouvrir le panier" link again (e.g.
  // after "Annuler") loads the draft again instead of being ignored.
  React.useEffect(() => {
    if (!draftId) handledRef.current = null;
  }, [draftId]);

  const apply = React.useCallback(async (draft: AiPosDraftForPosDto) => {
    const { fillCart, clearDraftParam } = latestRef.current;
    setBusy(true);
    try {
      const response = await fetch(`/api/pos/ai-draft/${encodeURIComponent(draft.id)}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Impossible d'ouvrir le panier préparé.");

      fillCart(draft);
      toast.success("Panier préparé par l'Assistant IA chargé. Vérifie-le puis valide la vente.");
      if (draft.unavailableProducts.length > 0) {
        toast.warning(
          `Retiré${draft.unavailableProducts.length > 1 ? "s" : ""} du panier (plus disponible${draft.unavailableProducts.length > 1 ? "s" : ""}) : ${draft.unavailableProducts.join(", ")}.`,
        );
      }
      if (draft.customerUnavailable) {
        toast.warning("Le client du panier préparé n'est plus disponible : le client par défaut est utilisé.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible d'ouvrir le panier préparé.");
    } finally {
      setBusy(false);
      setPendingDraft(null);
      clearDraftParam();
    }
  }, []);

  React.useEffect(() => {
    if (!draftId || !ready || handledRef.current === draftId) return;
    handledRef.current = draftId;
    const { blockedReason, clearDraftParam } = latestRef.current;
    if (blockedReason) {
      toast.error(blockedReason);
      clearDraftParam();
      return;
    }

    // No cancellation on cleanup: handledRef already guarantees one load per
    // draft id (a cleanup-cancel would lose it under StrictMode's re-run).
    void (async () => {
      try {
        const response = await fetch(`/api/pos/ai-draft/${encodeURIComponent(draftId)}`, { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as {
          draft?: AiPosDraftForPosDto;
          message?: string;
        };
        if (!response.ok || !payload.draft) {
          throw new Error(payload.message ?? "Impossible de charger le panier préparé.");
        }
        const draft = payload.draft;
        if (draft.lines.length === 0) {
          throw new Error("Le panier préparé ne contient plus aucun produit disponible.");
        }
        latestRef.current.registerProducts(draft.products);
        if (latestRef.current.hasCartContent()) setPendingDraft(draft);
        else await apply(draft);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Impossible de charger le panier préparé.");
        latestRef.current.clearDraftParam();
      }
    })();
  }, [draftId, ready, apply]);

  return {
    /** A draft is waiting for the "replace the current cart?" answer. */
    confirmOpen: pendingDraft !== null,
    busy,
    confirmReplace: () => {
      if (pendingDraft) void apply(pendingDraft);
    },
    cancelReplace: () => {
      // The draft stays OPEN: the user can open the link again later.
      setPendingDraft(null);
      latestRef.current.clearDraftParam();
      toast.message("Panier actuel conservé. Le panier préparé n'a pas été ouvert.");
    },
  };
}
