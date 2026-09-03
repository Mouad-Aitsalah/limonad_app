"use client";

import * as React from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { resetCompanyIdentityCache } from "@/hooks/use-company-identity";
import {
  LOGO_ACCEPTED_MIME,
  LOGO_MAX_BYTES_LABEL,
  readFileAsDataUrl,
  validateLogoFile,
} from "@/lib/logo-validation";
import type { OrganizationIdentity } from "@/lib/server/organization-identity";

export function CompanyIdentityView({
  initialIdentity,
}: {
  initialIdentity: OrganizationIdentity;
}) {
  const [identity, setIdentity] = React.useState(initialIdentity);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  async function save(logoDataUrl: string | null) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/organization/logo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoDataUrl }),
      });
      const body = (await response.json()) as {
        identity?: OrganizationIdentity;
        message?: string;
        fieldErrors?: Record<string, string>;
      };
      if (!response.ok || !body.identity) {
        setError(body.fieldErrors?.logo ?? body.message ?? "Enregistrement impossible.");
        return;
      }
      setIdentity(body.identity);
      // Push the new identity into the shared cache so the sidebar/ticket
      // update immediately, without a reload.
      resetCompanyIdentityCache({
        name: body.identity.name,
        tradeName: body.identity.tradeName,
        logoUrl: body.identity.logoUrl,
      });
      toast.success(logoDataUrl ? "Logo mis à jour." : "Logo supprimé.");
    } catch {
      setError("Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;

    const check = validateLogoFile(file);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await save(dataUrl);
    } catch {
      setError("Lecture du fichier impossible.");
    }
  }

  const hasLogo = Boolean(identity.logoUrl);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Paramètres</h1>
        <p className="text-sm text-muted-foreground">Identité de l&apos;entreprise</p>
      </div>

      <Card className="max-w-2xl ring-0 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="space-y-6">
          <h2 className="font-heading text-lg font-semibold text-foreground">
            Identité de l&apos;entreprise
          </h2>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Nom</Label>
            <p className="text-sm font-medium text-foreground">
              {identity.tradeName || identity.name}
            </p>
          </div>

          <div className="space-y-3">
            <Label className="text-xs text-muted-foreground">Logo</Label>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted/30">
                {hasLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={identity.logoUrl as string}
                    alt={identity.name}
                    className="h-full w-full object-contain p-1"
                  />
                ) : (
                  <span className="text-2xl font-bold text-muted-foreground">
                    {(identity.tradeName || identity.name).charAt(0).toUpperCase()}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus className="h-4 w-4" />
                  {hasLogo ? "Remplacer" : "Importer un logo"}
                </Button>
                {hasLogo ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void save(null)}
                    className="text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                    Supprimer
                  </Button>
                ) : null}
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={LOGO_ACCEPTED_MIME.join(",")}
              className="hidden"
              onChange={handleFile}
            />

            {error ? <p className="text-xs text-destructive">{error}</p> : null}

            <p className="text-xs text-muted-foreground">
              Formats acceptés : PNG, JPG ou WEBP. Taille maximale : {LOGO_MAX_BYTES_LABEL}.
              Le logo apparaît dans la barre latérale et sur les tickets de vente.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
