"use client";

import * as React from "react";
import { Bot, LoaderCircle, Send, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

const welcomeMessage: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Bonjour ! Je suis l’assistant IA de COMDIS. Vous pouvez me demander combien de produits sont enregistrés dans votre organisation.",
};

function createMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: `${role}-${crypto.randomUUID()}`,
    role,
    content,
  };
}

export function AssistantChat() {
  const [messages, setMessages] = React.useState<ChatMessage[]>([welcomeMessage]);
  const [message, setMessage] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [isLoading, messages]);

  async function sendMessage() {
    const trimmedMessage = message.trim();
    if (!trimmedMessage || isLoading) return;

    setMessage("");
    setError(null);
    setMessages((current) => [...current, createMessage("user", trimmedMessage)]);
    setIsLoading(true);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmedMessage }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        response?: string;
        message?: string;
      };

      if (!response.ok) {
        setError(data.message ?? "Impossible de joindre l’assistant IA.");
        return;
      }

      setMessages((current) => [
        ...current,
        createMessage("assistant", data.response ?? "Je n’ai pas pu générer de réponse."),
      ]);
    } catch {
      setError("Impossible de joindre l’assistant IA.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

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
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto py-1" aria-live="polite">
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
                    chatMessage.role === "user"
                      ? "bg-foreground text-background"
                      : "bg-emerald-100 text-emerald-700",
                  )}
                >
                  {chatMessage.role === "user" ? (
                    <UserRound aria-hidden="true" className="h-4 w-4" />
                  ) : (
                    <Bot aria-hidden="true" className="h-4 w-4" />
                  )}
                </div>
                <p
                  className={cn(
                    "whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6",
                    chatMessage.role === "user"
                      ? "rounded-tr-sm bg-emerald-600 text-white"
                      : "rounded-tl-sm bg-muted text-foreground",
                  )}
                >
                  {chatMessage.content}
                </p>
              </div>
            ))}

            {isLoading && (
              <div className="mr-auto flex items-center gap-2.5 text-sm text-muted-foreground">
                <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin text-emerald-600" />
                L’assistant réfléchit…
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex items-end gap-2 border-t border-border/70 pt-4">
            <Textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              placeholder="Écrivez votre question…"
              aria-label="Message pour l’assistant IA"
              className="max-h-32 min-h-12 resize-none"
            />
            <Button
              type="button"
              size="icon"
              disabled={!message.trim() || isLoading}
              onClick={() => void sendMessage()}
              aria-label="Envoyer le message"
              className="h-12 w-12 shrink-0 rounded-xl bg-emerald-600 hover:bg-emerald-700"
            >
              <Send aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
