"use client";

import { Bot } from "lucide-react";

import { AssistantComposer } from "@/components/assistant/assistant-composer";
import { AssistantMessageList } from "@/components/assistant/assistant-message-list";
import { useAssistantConversation } from "@/components/assistant/use-assistant-conversation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Full-page AI Assistant (/assistant-ia). The conversation logic, the message
 * list and the message field are shared with the floating panel opened from
 * the header (components/assistant/assistant-panel.tsx).
 */
export function AssistantChat() {
  const conversation = useAssistantConversation();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Assistant IA</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Les réponses concernent uniquement l’organisation connectée.
        </p>
      </div>

      <Card className="min-h-[min(42rem,calc(100dvh-14rem))] shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
        <CardHeader className="border-b border-border/70 pb-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
              <Bot aria-hidden="true" className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Assistant IA</CardTitle>
              <CardDescription>Vos données restent limitées à votre organisation.</CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
          <AssistantMessageList messages={conversation.messages} isLoading={conversation.isLoading} />

          {conversation.error && (
            <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {conversation.error}
            </p>
          )}

          <AssistantComposer
            onSend={conversation.send}
            isLoading={conversation.isLoading}
            className="border-t border-border/70 pt-4"
          />
        </CardContent>
      </Card>
    </div>
  );
}
