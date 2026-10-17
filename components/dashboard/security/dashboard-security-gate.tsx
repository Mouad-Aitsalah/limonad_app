"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, LockKeyhole, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DASHBOARD_PASSWORD_MIN_LENGTH,
  dashboardRenewalPeriodLabel,
  type DashboardGateDto,
} from "@/lib/dashboard-security";

import {
  INITIAL_GATE_STATE,
  REFRESH_TIMEOUT_MS,
  UNEXPECTED_RESPONSE_MESSAGE,
  gateReducer,
  postSecurityRequest,
  type GateState,
} from "./dashboard-gate-state";

const UNLOCK_ENDPOINT = "/api/dashboard/security/unlock";
const PASSWORD_ENDPOINT = "/api/dashboard/security/password";

/**
 * Submits a password form and follows it to the end. The request has a 20 s timeout and always settles
 * (dashboard-gate-state.ts), a refusal / network error / timeout puts the screen back to idle with a message, and
 * after a VALIDATED password the screen waits for router.refresh() (in a transition): if the dashboard has not
 * replaced the screen when the refresh ends - or after 20 s - it says so explicitly instead of spinning forever,
 * and never presents that case as a wrong password.
 */
function useGateSubmission(endpoint: string) {
  const router = useRouter();
  const [state, dispatch] = React.useReducer(gateReducer, INITIAL_GATE_STATE);
  const [refreshing, startRefresh] = React.useTransition();
  const sawRefreshing = React.useRef(false);

  const submit = React.useCallback(
    async (payload: Record<string, string>): Promise<boolean> => {
      dispatch({ type: "submit" });
      try {
        const result = await postSecurityRequest(endpoint, payload);
        if (!result.ok) {
          dispatch({ type: "rejected", message: result.message });
          return false;
        }
        sawRefreshing.current = false;
        dispatch({ type: "validated" });
        startRefresh(() => router.refresh());
        return true;
      } catch {
        dispatch({ type: "rejected", message: UNEXPECTED_RESPONSE_MESSAGE });
        return false;
      }
    },
    [endpoint, router],
  );

  React.useEffect(() => {
    if (state.phase !== "refreshing") return;
    if (refreshing) {
      sawRefreshing.current = true;
      return;
    }
    if (sawRefreshing.current) {
      sawRefreshing.current = false;
      dispatch({ type: "refresh-ended" });
    }
  }, [refreshing, state.phase]);

  React.useEffect(() => {
    if (state.phase !== "refreshing") return;
    const timer = window.setTimeout(() => dispatch({ type: "refresh-ended" }), REFRESH_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [state.phase]);

  return { state, submit, pending: state.phase !== "idle" };
}

/** Explains a failure and, when the password was accepted but the dashboard did not open, offers the reload. */
function GateMessage({ state, testId }: { state: GateState; testId: string }) {
  if (!state.error) return null;
  return (
    <div className="space-y-2">
      <p role="alert" className="text-sm text-destructive" data-testid={testId}>
        {state.error}
      </p>
      {state.refreshFailed ? (
        <Button type="button" variant="outline" size="sm" data-testid="dashboard-gate-reload" onClick={() => window.location.reload()}>
          Recharger la page
        </Button>
      ) : null}
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoFocus,
  autoComplete,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  autoComplete: string;
  disabled?: boolean;
}) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          disabled={disabled}
          maxLength={128}
          onChange={(event) => onChange(event.target.value)}
          className="pr-12"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          {visible ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

/** « Mot de passe du dashboard »: asked at every visit, in a modal (the server refuses all dashboard data meanwhile). */
function UnlockDialog() {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const { state, submit: send, pending } = useGateSubmission(UNLOCK_ENDPOINT);
  const fieldId = React.useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!password || pending) return;
    await send({ password });
    setPassword("");
  }

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent showCloseButton={false} className="sm:max-w-md" data-testid="dashboard-unlock">
        <DialogHeader>
          <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <LockKeyhole aria-hidden="true" className="h-5 w-5" />
          </div>
          <DialogTitle>Dashboard protégé</DialogTitle>
          <DialogDescription>Saisissez le mot de passe du dashboard pour afficher les chiffres de l&apos;organisation.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
          <PasswordField
            id={fieldId}
            label="Mot de passe du dashboard"
            value={password}
            onChange={setPassword}
            autoFocus
            autoComplete="off"
            disabled={pending}
          />
          <GateMessage state={state} testId="dashboard-unlock-error" />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={pending} onClick={() => router.back()}>
              Annuler
            </Button>
            <Button type="submit" disabled={!password || pending}>
              {pending ? "Vérification…" : "Déverrouiller"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasswordRules({ password }: { password: string }) {
  const rules = [
    { label: `${DASHBOARD_PASSWORD_MIN_LENGTH} caractères minimum`, ok: password.length >= DASHBOARD_PASSWORD_MIN_LENGTH },
    { label: "Une minuscule", ok: /[a-z]/.test(password) },
    { label: "Une majuscule", ok: /[A-Z]/.test(password) },
    { label: "Un chiffre", ok: /[0-9]/.test(password) },
  ];
  return (
    <ul className="grid gap-1.5 text-xs sm:grid-cols-2" aria-label="Règles du mot de passe">
      {rules.map((rule) => (
        <li key={rule.label} className={`flex items-center gap-1.5 ${rule.ok ? "text-emerald-700" : "text-muted-foreground"}`}>
          <Check aria-hidden="true" className={`h-3.5 w-3.5 ${rule.ok ? "opacity-100" : "opacity-30"}`} />
          {rule.label}
        </li>
      ))}
    </ul>
  );
}

/** First creation / renewal of the dashboard password (admin of the organisation only). */
function PasswordSetupCard({ gate }: { gate: DashboardGateDto }) {
  const [password, setPassword] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const { state, submit: send, pending } = useGateSubmission(PASSWORD_ENDPOINT);
  const idPrefix = React.useId();
  const renewal = gate.state === "renewal_required";
  const mismatch = confirmation.length > 0 && password !== confirmation;
  const ready =
    password.length >= DASHBOARD_PASSWORD_MIN_LENGTH &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    password === confirmation;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || pending) return;
    if (await send({ password, confirmation })) {
      setPassword("");
      setConfirmation("");
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg py-4 sm:py-10" data-testid="dashboard-password-setup">
      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <LockKeyhole aria-hidden="true" className="h-5 w-5" />
            </div>
            <h1 className="font-heading text-xl font-semibold text-foreground">
              {renewal ? "Renouveler le mot de passe du dashboard" : "Créer le mot de passe du dashboard"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {renewal
                ? "Le mot de passe du dashboard a expiré. Définissez-en un nouveau pour continuer."
                : "La sécurité du dashboard est activée pour votre organisation. Définissez un mot de passe dédié : il sera demandé à chaque ouverture du dashboard."}{" "}
              {gate.renewalEnabled
                ? `Il devra être renouvelé après chaque période de ${dashboardRenewalPeriodLabel(gate.renewalPeriod)}.`
                : "Il reste valable jusqu'à sa réinitialisation."}
            </p>
          </div>
          <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
            <PasswordField
              id={`${idPrefix}-password`}
              label="Nouveau mot de passe"
              value={password}
              onChange={setPassword}
              autoFocus
              autoComplete="new-password"
              disabled={pending}
            />
            <PasswordRules password={password} />
            <PasswordField
              id={`${idPrefix}-confirmation`}
              label="Confirmer le mot de passe"
              value={confirmation}
              onChange={setConfirmation}
              autoComplete="new-password"
              disabled={pending}
            />
            {mismatch ? (
              <p className="text-sm text-destructive" data-testid="dashboard-password-mismatch">
                Les deux mots de passe ne correspondent pas.
              </p>
            ) : null}
            <GateMessage state={state} testId="dashboard-password-error" />
            <Button type="submit" className="w-full" disabled={!ready || pending}>
              {pending ? "Enregistrement…" : renewal ? "Renouveler et ouvrir le dashboard" : "Créer et ouvrir le dashboard"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/** A user who is not the organisation's admin cannot create / renew the password. */
function WaitingForAdminCard({ renewal }: { renewal: boolean }) {
  return (
    <div className="mx-auto w-full max-w-lg py-4 sm:py-10" data-testid="dashboard-waiting-admin">
      <Card className="ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
        <CardContent className="space-y-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
            <ShieldAlert aria-hidden="true" className="h-5 w-5" />
          </div>
          <h1 className="font-heading text-xl font-semibold text-foreground">Dashboard protégé</h1>
          <p className="text-sm text-muted-foreground">
            {renewal
              ? "Le mot de passe du dashboard a expiré. L'administrateur de l'organisation doit en définir un nouveau avant que le dashboard soit de nouveau accessible."
              : "L'administrateur de l'organisation doit d'abord définir le mot de passe du dashboard avant que le dashboard soit accessible."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * What /dashboard shows INSTEAD of the figures while the dashboard security requires an action. The server
 * renders no dashboard data in these cases - this component only collects the password.
 */
export function DashboardSecurityGate({ gate }: { gate: DashboardGateDto }) {
  if (gate.state === "unlock_required") return <UnlockDialog />;
  if (!gate.canSetPassword) return <WaitingForAdminCard renewal={gate.state === "renewal_required"} />;
  return <PasswordSetupCard gate={gate} />;
}
