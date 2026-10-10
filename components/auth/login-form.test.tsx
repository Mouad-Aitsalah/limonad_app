import assert from "node:assert/strict";
import { test } from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

import { AuthContext, type AuthContextValue } from "@/hooks/use-auth";

import { LOGIN_FORM_ACTION, LoginForm } from "./login-form";

/**
 * Regression: a staff login submitted BEFORE React hydrated (slow network,
 * JS still loading) is a native browser submission. The form used to have no
 * method/action, so the browser sent a GET to /login with the email and the
 * password in the URL (seen during the Espace Client browser test). The HTML
 * the server renders - i.e. exactly what the browser has before hydration -
 * must make that native submission a POST to the login route, never a GET.
 * No database, no network: only the rendered markup is checked.
 */

const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop, hmrRefresh: noop };
const auth: AuthContextValue = {
  currentUser: null,
  isLoading: false,
  login: async () => ({ success: false, error: "test" }),
  logout: async () => {},
  refreshSession: async () => {},
};

function renderPreHydrationHtml(search = ""): string {
  return renderToStaticMarkup(
    React.createElement(
      AppRouterContext.Provider,
      { value: router as never },
      React.createElement(
        SearchParamsContext.Provider,
        { value: new URLSearchParams(search) },
        React.createElement(AuthContext.Provider, { value: auth }, React.createElement(LoginForm)),
      ),
    ),
  );
}

/** The attributes of the (single) login <form> opening tag. */
function formAttributes(html: string): Record<string, string> {
  const forms = html.match(/<form\b[^>]*>/gi) ?? [];
  assert.equal(forms.length, 1, "exactly one login form");
  return Object.fromEntries(
    [...forms[0].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((match) => [match[1].toLowerCase(), match[2]]),
  );
}

/**
 * What a browser does on a native submission (HTML spec, simplified to the
 * two methods): GET puts the fields in the URL query, POST puts them in the
 * body. Returns the URL the browser would request.
 */
function nativeSubmissionUrl(attrs: Record<string, string>, pageUrl: string, fields: Record<string, string>): string {
  const target = new URL(attrs.action ?? "", pageUrl);
  const method = (attrs.method ?? "get").toLowerCase();
  if (method === "get") target.search = new URLSearchParams(fields).toString();
  return target.toString();
}

test("before hydration the login form submits with POST to the login route, never GET", () => {
  const attrs = formAttributes(renderPreHydrationHtml());
  assert.equal(attrs.method?.toLowerCase(), "post", "an explicit method=post (the browser default is GET)");
  assert.equal(attrs.action, LOGIN_FORM_ACTION);
  assert.equal(LOGIN_FORM_ACTION, "/api/auth/login");
  assert.equal(attrs.action.includes("?"), false, "no query string in the action");
});

test("a native submission never puts the email or the password in the URL", () => {
  const html = renderPreHydrationHtml();
  const attrs = formAttributes(html);
  const url = nativeSubmissionUrl(attrs, "https://comdis.example/login", {
    email: "admin@example.com",
    password: "S3cret-pass",
  });
  assert.equal(url, "https://comdis.example/api/auth/login");
  assert.equal(url.includes("S3cret-pass"), false);
  assert.equal(url.includes("admin"), false);
  // the fields keep the names the login route reads from a form body
  assert.match(html, /<input[^>]*\bname="email"/);
  assert.match(html, /<input[^>]*\bname="password"[^>]*type="password"|<input[^>]*type="password"[^>]*\bname="password"/);
});

test("the form markup is the same whatever the page query (e.g. after a failed login redirect)", () => {
  const attrs = formAttributes(renderPreHydrationHtml("error=invalid_credentials"));
  assert.equal(attrs.method?.toLowerCase(), "post");
  assert.equal(attrs.action, LOGIN_FORM_ACTION);
  assert.match(renderPreHydrationHtml("error=invalid_credentials"), /Email ou mot de passe incorrect\./);
});
