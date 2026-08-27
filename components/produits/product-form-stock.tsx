import * as React from "react";
import Image from "next/image";
import { ImagePlus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProductFormValues } from "@/components/produits/product-form";

type ProductFormStockProps = {
  values: ProductFormValues;
  onChange: <K extends keyof ProductFormValues>(
    field: K,
    value: ProductFormValues[K],
  ) => void;
  fieldErrors: Record<string, string>;
  readOnly: boolean;
};

const passthroughImageLoader = ({ src }: { src: string }) => src;

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

export function ProductFormStock({
  values,
  onChange,
  fieldErrors,
  readOnly,
}: ProductFormStockProps) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [uploadError, setUploadError] = React.useState<string>("");

  function openFilePicker() {
    if (readOnly) return;
    fileInputRef.current?.click();
  }

  function removeImage() {
    setUploadError("");
    onChange("imageUrl", "");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleUrlChange(value: string) {
    setUploadError("");
    onChange("imageUrl", value);
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setUploadError("Selectionnez un fichier image valide.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setUploadError("L'image ne doit pas depasser 2 Mo.");
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    setUploadError("");
    onChange("imageUrl", dataUrl);
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          Catalogue et seuil
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          La quantite reelle du stock est geree separement dans StockLevel.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="minimumStock">Stock minimum</Label>
            <Input
              id="minimumStock"
              type="number"
              min={0}
              value={values.minimumStock}
              disabled={readOnly}
              onChange={(event) =>
                onChange("minimumStock", Number(event.target.value))
              }
            />
            <FieldError message={fieldErrors.minimumStock} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="unit">Unite</Label>
            <Input
              id="unit"
              value={values.unit}
              disabled={readOnly}
              onChange={(event) => onChange("unit", event.target.value)}
              placeholder="piece, paire, boite..."
            />
            <FieldError message={fieldErrors.unit} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <div className="space-y-3 rounded-2xl border border-border p-4">
              <div className="space-y-1">
                <Label>Photo du produit</Label>
                <p className="text-xs text-muted-foreground">
                  Ajoutez une photo, remplacez-la a tout moment, ou supprimez-la pour revenir au placeholder.
                </p>
              </div>

              <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                <div className="overflow-hidden rounded-2xl border border-border bg-muted/40">
                  {values.imageUrl ? (
                    <Image
                      loader={passthroughImageLoader}
                      unoptimized
                      src={values.imageUrl}
                      alt="Apercu du produit"
                      width={160}
                      height={160}
                      className="h-40 w-full object-cover lg:w-40"
                    />
                  ) : (
                    <div className="flex h-40 w-full items-center justify-center bg-[radial-gradient(circle_at_top,#d1fae5,transparent_58%),linear-gradient(135deg,#ecfdf5_0%,#d1fae5_100%)] text-emerald-700 lg:w-40">
                      <ImagePlus className="h-8 w-8" />
                    </div>
                  )}
                </div>

                <div className="flex-1 space-y-3">
                  {!readOnly && (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleFileChange}
                        className="hidden"
                      />

                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" onClick={openFilePicker}>
                          <ImagePlus className="h-4 w-4" />
                          {values.imageUrl ? "Remplacer la photo" : "Ajouter une photo"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={removeImage}
                          disabled={!values.imageUrl}
                        >
                          <Trash2 className="h-4 w-4" />
                          Supprimer l&apos;image
                        </Button>
                      </div>

                      {uploadError && (
                        <p className="text-xs text-destructive">{uploadError}</p>
                      )}
                    </>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="imageUrl">URL de l&apos;image</Label>
                    <Input
                      id="imageUrl"
                      value={values.imageUrl ?? ""}
                      disabled={readOnly}
                      onChange={(event) => handleUrlChange(event.target.value)}
                      placeholder="Optionnel"
                    />
                    <p className="text-xs text-muted-foreground">
                      Vous pouvez utiliser une URL publique ou une image importee depuis votre appareil.
                    </p>
                    <FieldError message={fieldErrors.imageUrl} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Impossible de lire l'image."));
    };
    reader.onerror = () => reject(new Error("Impossible de lire l'image."));
    reader.readAsDataURL(file);
  });
}
