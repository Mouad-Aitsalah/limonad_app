"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Tooltip } from "@base-ui/react/tooltip";
import { Bot, RotateCcw, X } from "lucide-react";

import { ASSISTANT_PAGE_PATH, canUseAssistant } from "@/components/assistant/assistant-access";
import { AssistantComposer } from "@/components/assistant/assistant-composer";
import { AssistantMessageList } from "@/components/assistant/assistant-message-list";
import {
  useAssistantConversation,
  type AssistantConversation,
} from "@/components/assistant/use-assistant-conversation";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

/**
 * Quick access to the AI Assistant from every ERP page: a robot button next to
 * the user profile (desktop header and mobile header) opening a floating chat
 * panel in the bottom-right corner, without leaving the page.
 *
 * Same engine as /assistant-ia: the panel uses the shared conversation hook,
 * i.e. the existing POST /api/ai/chat route with all its rules. Only offered to
 * the roles allowed to use the assistant (admin), never on /assistant-ia itself.
 * The conversation lives in this provider (mounted once by the dashboard
 * shell), so closing / reopening the panel or moving to another page keeps it.
 */

export const ASSISTANT_PANEL_ID = "assistant-ia-panel";

type AssistantPanelState = { open: boolean; toggle: () => void; close: () => void };

const AssistantPanelContext = React.createContext<AssistantPanelState | null>(null);

export function AssistantPanelProvider({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();
  const pathname = usePathname();
  const enabled = canUseAssistant(currentUser?.role) && pathname !== ASSISTANT_PAGE_PATH;
  const [open, setOpen] = React.useState(false);
  const conversation = useAssistantConversation();

  const toggle = React.useCallback(() => setOpen((current) => !current), []);
  const close = React.useCallback(() => setOpen(false), []);
  const value = React.useMemo(() => (enabled ? { open, toggle, close } : null), [enabled, open, toggle, close]);

  return (
    <AssistantPanelContext.Provider value={value}>
      {children}
      {enabled && open ? <AssistantFloatingPanel conversation={conversation} onClose={close} /> : null}
    </AssistantPanelContext.Provider>
  );
}

/** The robot button. Renders nothing outside the provider or for a role without the assistant. */
export function AssistantLauncherButton({ compact = false, className }: { compact?: boolean; className?: string }) {
  const panel = React.useContext(AssistantPanelContext);
  if (!panel) return null;
  return <AssistantLauncherButtonView open={panel.open} onToggle={panel.toggle} compact={compact} className={className} />;
}

/** Presentational robot button (no context): tooltip, open state, hover effect. */
export function AssistantLauncherButtonView({
  open,
  onToggle,
  compact = false,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  compact?: boolean;
  className?: string;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        delay={200}
        render={
          <button
            type="button"
            aria-label="Assistant IA"
            aria-expanded={open}
            aria-controls={ASSISTANT_PANEL_ID}
            onClick={onToggle}
            data-testid="assistant-launcher"
            className={cn(
              "grid shrink-0 place-items-center bg-[linear-gradient(135deg,#173156_0%,#0f7a5d_100%)] text-white shadow-[0_10px_24px_rgba(23,49,86,0.22)] transition-all duration-200 outline-none hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(15,122,93,0.32)] focus-visible:ring-4 focus-visible:ring-emerald-500/25 aria-expanded:ring-2 aria-expanded:ring-emerald-300",
              compact ? "h-10 w-10 rounded-full" : "h-11 w-11 rounded-2xl",
              className,
            )}
          />
        }
      >
        <Bot aria-hidden="true" className={compact ? "h-5 w-5" : "h-[22px] w-[22px]"} />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="bottom" sideOffset={8} className="z-50">
          <Tooltip.Popup className="rounded-lg bg-[#173156] px-2.5 py-1 text-xs font-medium text-white shadow-[0_8px_20px_rgba(15,23,42,0.18)]">
            Assistant IA
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** The floating chat window (bottom-right; full width minus margins on a phone). */
export function AssistantFloatingPanel({
  conversation,
  onClose,
}: {
  conversation: AssistantConversation;
  onClose: () => void;
}) {
  const titleId = React.useId();

  return (
    <section
      id={ASSISTANT_PANEL_ID}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid="assistant-panel"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      className="fixed right-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] left-3 z-40 flex h-[min(550px,calc(100dvh-5.5rem))] flex-col overflow-hidden rounded-[24px] border border-border/70 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.18)] sm:right-6 sm:bottom-6 sm:left-auto sm:w-[400px] lg:h-[min(550px,calc(100dvh-8rem))]"
    >
      <header className="flex items-center gap-3 bg-[linear-gradient(135deg,#173156_0%,#0f7a5d_100%)] px-4 py-3 text-white">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15">
          <Bot aria-hidden="true" className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="font-heading text-base leading-tight font-semibold text-white">
            Assistant IA
          </h2>
          <p className="truncate text-xs text-white/75">Données limitées à votre organisation</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer l’assistant IA"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white/85 transition-colors outline-none hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </header>

      <AssistantMessageList
        contained
        messages={conversation.messages}
        isLoading={conversation.isLoading}
        className="min-h-0 bg-slate-50/60 px-4 py-3"
      />

      {conversation.error ? (
        <div
          role="alert"
          className="mx-3 mt-2 flex items-center gap-2 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <p className="min-w-0 flex-1">{conversation.error}</p>
          {conversation.canRetry ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={conversation.retry}
              className="shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10"
            >
              <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
              Réessayer
            </Button>
          ) : null}
        </div>
      ) : null}

      <AssistantComposer
        autoFocus
        onSend={conversation.send}
        isLoading={conversation.isLoading}
        className="border-t border-border/70 px-3 pt-3 pb-3"
      />
    </section>
  );
}
