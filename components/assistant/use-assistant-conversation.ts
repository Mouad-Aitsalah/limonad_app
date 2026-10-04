"use client";

import * as React from "react";

/**
 * Conversation logic of the AI Assistant, shared by the full page
 * (/assistant-ia, components/assistant/assistant-chat.tsx) and the floating
 * panel opened from the header (components/assistant/assistant-panel.tsx).
 * One engine only: both call the existing POST /api/ai/chat route, which keeps
 * every rule (session, admin role, organisation scoping, CSRF, conversation
 * ownership, Gemini tools). Nothing here answers on its own.
 */

export type AssistantChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

export const ASSISTANT_WELCOME_MESSAGE: AssistantChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Bonjour ! Je suis l’assistant IA de COMDIS. Vous pouvez me demander combien de produits sont enregistrés dans votre organisation.",
};

export const ASSISTANT_UNREACHABLE_MESSAGE = "Impossible de joindre l’assistant IA.";
export const ASSISTANT_EMPTY_RESPONSE = "Je n’ai pas pu générer de réponse.";

export function createAssistantMessage(role: AssistantChatMessage["role"], content: string): AssistantChatMessage {
  return { id: `${role}-${crypto.randomUUID()}`, role, content };
}

export type AssistantReply =
  | { ok: true; response: string; conversationId: string | null }
  | { ok: false; message: string };

/**
 * One call to the existing route. Pure apart from `fetchImpl` (injected for the
 * tests): the server's own error message is shown as is, a network failure or
 * an unreadable body becomes the generic "unreachable" message.
 */
export async function postAssistantMessage(
  fetchImpl: typeof fetch,
  message: string,
  conversationId: string | null,
): Promise<AssistantReply> {
  try {
    const response = await fetchImpl("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      response?: string;
      conversationId?: string;
      message?: string;
    };
    if (!response.ok) return { ok: false, message: data.message ?? ASSISTANT_UNREACHABLE_MESSAGE };
    return {
      ok: true,
      response: data.response ?? ASSISTANT_EMPTY_RESPONSE,
      conversationId: data.conversationId ?? null,
    };
  } catch {
    return { ok: false, message: ASSISTANT_UNREACHABLE_MESSAGE };
  }
}

export type AssistantConversation = {
  messages: AssistantChatMessage[];
  isLoading: boolean;
  error: string | null;
  /** Sends a new question. Returns false when nothing was sent (empty text, or a reply is pending). */
  send: (text: string) => boolean;
  /** Resends the last question that failed (its bubble is not duplicated). */
  retry: () => void;
  /** true when the last question failed and can be sent again. */
  canRetry: boolean;
};

export function useAssistantConversation(fetchImpl: typeof fetch = (...args) => fetch(...args)): AssistantConversation {
  const [messages, setMessages] = React.useState<AssistantChatMessage[]>([ASSISTANT_WELCOME_MESSAGE]);
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [failedMessage, setFailedMessage] = React.useState<string | null>(null);
  const loadingRef = React.useRef(false);

  const ask = React.useCallback(
    async (text: string) => {
      loadingRef.current = true;
      setIsLoading(true);
      setError(null);
      setFailedMessage(null);
      const reply = await postAssistantMessage(fetchImpl, text, conversationId);
      if (reply.ok) {
        if (reply.conversationId) setConversationId(reply.conversationId);
        setMessages((current) => [...current, createAssistantMessage("assistant", reply.response)]);
      } else {
        setError(reply.message);
        setFailedMessage(text);
      }
      loadingRef.current = false;
      setIsLoading(false);
    },
    [conversationId, fetchImpl],
  );

  const send = React.useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loadingRef.current) return false;
      setMessages((current) => [...current, createAssistantMessage("user", trimmed)]);
      void ask(trimmed);
      return true;
    },
    [ask],
  );

  const retry = React.useCallback(() => {
    if (!failedMessage || loadingRef.current) return;
    void ask(failedMessage);
  }, [ask, failedMessage]);

  return { messages, isLoading, error, send, retry, canRetry: failedMessage !== null && !isLoading };
}
