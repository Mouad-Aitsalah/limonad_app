import { AuthServiceError } from "@/lib/server/auth";
import { handleTranscribeRequest } from "@/lib/server/assistant-transcribe";
import { rejectUntrustedOrigin } from "@/lib/server/csrf";
import { requireOrganizationUser } from "@/lib/server/organization-context";
import { transcribeAudio } from "@/lib/server/speech-to-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Voice input of the AI Assistant, phase 1: audio in, text out. Same
 * protection as POST /api/ai/chat (CSRF origin check + admin session). It only
 * transcribes: it never calls the agent - the user reads the text in the input
 * and presses "Envoyer" himself. Only POST exists (any other method: 405).
 */
export async function POST(request: Request) {
  return handleTranscribeRequest(request, {
    rejectUntrustedOrigin,
    requireAdmin: () => requireOrganizationUser(["admin"]),
    transcribe: transcribeAudio,
    describeAuthError: (error) =>
      error instanceof AuthServiceError ? { message: error.message, status: error.status } : null,
  });
}
