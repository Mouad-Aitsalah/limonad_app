import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ASSISTANT_PAGE_PATH, ASSISTANT_ROLES, canUseAssistant } from "@/components/assistant/assistant-access";
import { AssistantMessageList } from "@/components/assistant/assistant-message-list";
import { AssistantFloatingPanel } from "@/components/assistant/assistant-panel";
import {
  ASSISTANT_EMPTY_RESPONSE,
  ASSISTANT_UNREACHABLE_MESSAGE,
  ASSISTANT_WELCOME_MESSAGE,
  postAssistantMessage,
  type AssistantConversation,
} from "@/components/assistant/use-assistant-conversation";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const text = (markup: string) =>
  markup.replace(/<[^>]+>/g, " ").split("&#x27;").join("'").split("&amp;").join("&").replace(/\s+/g, " ");

// ---- the call to the existing route --------------------------------------------------------------

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("route: the panel posts to the existing /api/ai/chat route, with the conversation id once known", async () => {
  const { impl, calls } = fakeFetch(() => json(200, { response: "16 produits.", conversationId: "conv-1" }));
  const first = await postAssistantMessage(impl, "Combien de produits ?", null);
  assert.deepEqual(first, { ok: true, response: "16 produits.", conversationId: "conv-1" });
  assert.equal(calls[0].url, "/api/ai/chat");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { message: "Combien de produits ?" });

  await postAssistantMessage(impl, "Et les clients ?", "conv-1");
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), { message: "Et les clients ?", conversationId: "conv-1" });
});

test("route: the server's own refusal / error message is shown as is (403, 429, 500...)", async () => {
  const { impl } = fakeFetch(() => json(403, { message: "Acces non autorise." }));
  assert.deepEqual(await postAssistantMessage(impl, "x", null), { ok: false, message: "Acces non autorise." });
});

test("route: network failure or unreadable body -> a readable generic error (never a fake answer)", async () => {
  const down = fakeFetch(() => {
    throw new TypeError("Failed to fetch");
  });
  assert.deepEqual(await postAssistantMessage(down.impl, "x", null), { ok: false, message: ASSISTANT_UNREACHABLE_MESSAGE });
  const broken = fakeFetch(() => new Response("<html>502</html>", { status: 502 }));
  assert.deepEqual(await postAssistantMessage(broken.impl, "x", null), { ok: false, message: ASSISTANT_UNREACHABLE_MESSAGE });
  const empty = fakeFetch(() => json(200, {}));
  assert.deepEqual(await postAssistantMessage(empty.impl, "x", null), { ok: true, response: ASSISTANT_EMPTY_RESPONSE, conversationId: null });
});

// ---- permissions --------------------------------------------------------------------------------

test("access: the button is only for the roles the assistant already allows (admin), like the page, the menu and the route", () => {
  assert.deepEqual(ASSISTANT_ROLES, ["admin"]);
  assert.equal(canUseAssistant("admin"), true);
  for (const role of ["depot_manager", "cashier", "driver", "super_admin", undefined, null] as const) {
    assert.equal(canUseAssistant(role), false, String(role));
  }
  assert.match(read("../../app/api/ai/chat/route.ts"), /requireOrganizationUser\(\["admin"\]\)/);
  assert.match(read("../../app/(dashboard)/assistant-ia/page.tsx"), /requireOrganizationUser\(\["admin"\]\)/);
  assert.match(read("../layout/nav-items.ts"), /href: "\/assistant-ia",[\s\S]{0,120}roles: \["admin"\]/);
  assert.equal(ASSISTANT_PAGE_PATH, "/assistant-ia");
});

test("provider: offered only to an allowed role and not on the assistant page itself; one engine, no new route", () => {
  const panel = read("./assistant-panel.tsx");
  assert.match(panel, /canUseAssistant\(currentUser\?\.role\) && pathname !== ASSISTANT_PAGE_PATH/);
  assert.match(panel, /if \(!panel\) return null;/, "no provider / not allowed -> no button");
  assert.match(panel, /useAssistantConversation\(\)/);
  assert.equal(/fetch\(/.test(panel), false, "the panel never calls an API itself");
  const hook = read("./use-assistant-conversation.ts");
  assert.equal((hook.match(/"\/api\/ai\/chat"/g) ?? []).length, 1);
});

// ---- placement ----------------------------------------------------------------------------------

test("placement: next to the user profile on desktop, at the right of the mobile header, clear of the POS cart button", () => {
  const header = read("../layout/header.tsx");
  assert.match(header, /<AssistantLauncherButton \/>\s*<UserMenu/);
  const mobile = read("../mobile/mobile-header.tsx");
  assert.match(mobile, /<AssistantLauncherButton compact className=\{pathname === "\/pos" \? "mr-14" : undefined\} \/>/);
  const shell = read("../layout/dashboard-shell.tsx");
  assert.match(shell, /<AssistantPanelProvider>\s*<DashboardShellInner>/);
  // the driver shell has no provider: its MobileHeader shows no robot
  assert.equal(/AssistantPanelProvider/.test(read("../driver/driver-shell.tsx")), false);
});

test("the full page reuses the same conversation logic, message list and field", () => {
  const page = read("./assistant-chat.tsx");
  for (const shared of ["useAssistantConversation()", "<AssistantMessageList", "<AssistantComposer"]) {
    assert.ok(page.includes(shared), shared);
  }
  assert.equal(/fetch\(/.test(page), false);
});

test("button: robot icon, tooltip 'Assistant IA', accessible name and open state", () => {
  const panel = read("./assistant-panel.tsx");
  assert.match(panel, /aria-label="Assistant IA"/);
  assert.match(panel, /aria-expanded=\{open\}/);
  assert.match(panel, /<Tooltip\.Popup[\s\S]*?Assistant IA\s*<\/Tooltip\.Popup>/);
  assert.match(panel, /<Bot aria-hidden="true"/);
  assert.match(panel, /hover:-translate-y-0\.5/);
});

// ---- panel rendering ----------------------------------------------------------------------------

function conversation(overrides: Partial<AssistantConversation> = {}): AssistantConversation {
  return {
    messages: [
      ASSISTANT_WELCOME_MESSAGE,
      { id: "u1", role: "user", content: "Combien de produits ?" },
      { id: "a1", role: "assistant", content: "Vous avez **16** produits actifs." },
    ],
    isLoading: false,
    error: null,
    send: () => true,
    retry: () => {},
    canRetry: false,
    ...overrides,
  };
}

test("panel: header with the robot, the title and a close button; messages; the field with Enter / send", () => {
  const markup = renderToStaticMarkup(<AssistantFloatingPanel conversation={conversation()} onClose={() => {}} />);
  const out = text(markup);
  assert.match(markup, /role="dialog"/);
  assert.match(markup, /aria-label="Fermer l’assistant IA"/);
  assert.match(out, /Assistant IA/);
  assert.match(out, /Combien de produits \?/);
  assert.match(markup, /<strong[^>]*>16<\/strong>/, "answers rendered as Markdown");
  assert.match(markup, /aria-label="Message pour l’assistant IA"/);
  assert.match(markup, /aria-label="Envoyer le message"/);
});

test("panel: size bounded by the screen (400px wide from sm, 550px high at most), full width minus margins on a phone", () => {
  const markup = renderToStaticMarkup(<AssistantFloatingPanel conversation={conversation()} onClose={() => {}} />);
  for (const cls of ["fixed", "right-3", "left-3", "sm:w-[400px]", "sm:left-auto", "h-[min(550px,calc(100dvh-5.5rem))]", "lg:h-[min(550px,calc(100dvh-8rem))]", "z-40"]) {
    assert.ok(markup.includes(cls), cls);
  }
  assert.match(markup, /overflow-y-auto/, "messages scroll inside the panel");
});

test("panel: loading indicator while the assistant answers", () => {
  const out = text(renderToStaticMarkup(<AssistantFloatingPanel conversation={conversation({ isLoading: true })} onClose={() => {}} />));
  assert.match(out, /L’assistant réfléchit…/);
});

test("panel: a failed call shows a readable error with 'Réessayer'", () => {
  const markup = renderToStaticMarkup(
    <AssistantFloatingPanel conversation={conversation({ error: ASSISTANT_UNREACHABLE_MESSAGE, canRetry: true })} onClose={() => {}} />,
  );
  assert.match(markup, /role="alert"/);
  assert.match(text(markup), /Impossible de joindre l’assistant IA\. Réessayer/);
  const noRetry = renderToStaticMarkup(
    <AssistantFloatingPanel conversation={conversation({ error: "Acces non autorise.", canRetry: false })} onClose={() => {}} />,
  );
  assert.equal(/Réessayer/.test(noRetry), false);
});

test("message list: user and assistant clearly distinguished", () => {
  const markup = renderToStaticMarkup(<AssistantMessageList messages={conversation().messages} isLoading={false} contained />);
  assert.match(markup, /ml-auto flex-row-reverse/, "user on the right");
  assert.match(markup, /bg-emerald-600[^"]*text-white/, "user bubble");
  assert.match(markup, /mr-auto/, "assistant on the left");
  assert.match(markup, /bg-muted/, "assistant bubble");
});
