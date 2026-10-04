"use client";

import * as React from "react";
import { Bot, LoaderCircle, UserRound } from "lucide-react";

import { MarkdownMessage } from "@/components/assistant/markdown-message";
import type { AssistantChatMessage } from "@/components/assistant/use-assistant-conversation";
import { cn } from "@/lib/utils";

type AssistantMessageListProps = {
  messages: AssistantChatMessage[];
  isLoading: boolean;
  /**
   * true: the list is its own height-limited scroll area (floating panel) and
   * only that area scrolls to the latest message. false (full page): the
   * latest message is brought into view as before.
   */
  contained?: boolean;
  className?: string;
};

/** The conversation bubbles: the user's text on the right, the Markdown answers on the left. */
export function AssistantMessageList({ messages, isLoading, contained = false, className }: AssistantMessageListProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (contained) {
      const container = containerRef.current;
      if (container) container.scrollTop = container.scrollHeight;
      return;
    }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [contained, isLoading, messages]);

  return (
    <div
      ref={containerRef}
      className={cn("flex flex-1 flex-col gap-4 overflow-y-auto py-1", className)}
      aria-live="polite"
      data-testid="assistant-messages"
    >
      {messages.map((chatMessage) => (
        <div
          key={chatMessage.id}
          className={cn(
            "flex max-w-[88%] items-start gap-2.5",
            chatMessage.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto",
          )}
        >
          <div
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-full",
              chatMessage.role === "user" ? "bg-foreground text-background" : "bg-emerald-100 text-emerald-700",
            )}
          >
            {chatMessage.role === "user" ? (
              <UserRound aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Bot aria-hidden="true" className="h-4 w-4" />
            )}
          </div>
          {chatMessage.role === "user" ? (
            // What the user typed stays plain text.
            <p className="min-w-0 whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-emerald-600 px-4 py-3 text-sm leading-6 break-words text-white">
              {chatMessage.content}
            </p>
          ) : (
            // The AI answer is Markdown (bold, lists, headings, code, tables...).
            <div className="min-w-0 rounded-2xl rounded-tl-sm bg-muted px-4 py-3 text-sm leading-6 text-foreground">
              <MarkdownMessage>{chatMessage.content}</MarkdownMessage>
            </div>
          )}
        </div>
      ))}

      {isLoading && (
        <div role="status" className="mr-auto flex items-center gap-2.5 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin text-emerald-600" />
          L’assistant réfléchit…
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
