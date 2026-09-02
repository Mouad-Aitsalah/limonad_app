/**
 * Common `Sentry.init` options shared by the server, edge and client configs.
 * Privacy-safe by construction (see PHASE-4Q.3 / 4Q.4A):
 *   - sendDefaultPii: false
 *   - tracesSampleRate: 0            (no performance data at all for the pilot)
 *   - beforeSendTransaction -> null  (belt-and-braces: drop any transaction)
 *   - beforeSend -> scrubEvent       (strips headers/cookies/body/query + PII)
 *   - ignoreErrors: known, expected GPS-token messages
 *   - maxValueLength / normalizeDepth: bounded, to limit accidental leakage
 *
 * Session Replay is configured only in the client config, and is fully off.
 */
import { scrubEvent } from "@/lib/sentry-scrub";
import {
  isSentryEnabled,
  resolveSentryEnvironment,
  resolveSentryRelease,
} from "@/lib/sentry-env";

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

/** Expected, non-actionable error messages that must never create an issue. */
export const IGNORED_ERROR_MESSAGES: string[] = [
  "Jeton de suivi manquant.",
  "Jeton de suivi invalide ou expire.",
  "Position GPS trop imprecise.",
  "Position GPS trop ancienne ou indisponible.",
];

export function commonSentryInit() {
  return {
    dsn: DSN,
    enabled: isSentryEnabled(DSN),
    environment: resolveSentryEnvironment(),
    release: resolveSentryRelease(),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    maxValueLength: 2000,
    normalizeDepth: 3,
    ignoreErrors: IGNORED_ERROR_MESSAGES.slice() as (string | RegExp)[],
    beforeSend: scrubEvent,
    beforeSendTransaction: () => null,
  };
}
