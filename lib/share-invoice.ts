import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

import {
  generateInvoicePdf,
  getInvoicePdfFileName,
  type InvoicePdfInput,
} from "@/lib/invoice-pdf";

export type InvoiceShareResult = {
  fileName: string;
  method: "native" | "web" | "download";
};

function blobToBase64(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 8_192;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  });
}

function downloadPdf(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * Shares an already-persisted invoice as a real PDF. Native Capacitor uses an
 * app-cache URI and Android's share sheet; browsers use Web Share files when
 * available, otherwise they download the same generated PDF.
 *
 * FIX ANDROID PRINT BUTTON - `intent: "print"` reuses this exact
 * generate-PDF-then-hand-to-native-Android pipeline for the "Imprimer"
 * button (see driver-pos-view.tsx's own printSale) instead of the default
 * "share via WhatsApp" wording - Android's WebView never implements
 * `window.print()` (a silent no-op, unlike desktop/mobile-web browsers), so
 * there is no in-app print pipeline to trigger there at all. Handing the
 * SAME PDF to Android's native share sheet is the standard way an app
 * without its own print pipeline reaches the OS's print framework: most
 * devices list "Imprimer"/a connected printer alongside every other share
 * target for a PDF file, and any target that doesn't print (a PDF viewer,
 * a cloud drive) still lets the driver open/forward the exact same ticket -
 * never a worse outcome than today's silent no-op. Unlike sharing, printing
 * an in-progress cart preview (not yet a persisted sale) is completely
 * normal - callers never gate this on `sale.id` the way canShareWhatsApp
 * does.
 */
export async function shareInvoicePdf(
  input: InvoicePdfInput,
  intent: "share" | "print" = "share",
): Promise<InvoiceShareResult> {
  const fileName = getInvoicePdfFileName(input.sale.displayNumber);
  const blob = await generateInvoicePdf(input);
  const title =
    intent === "print" ? `Ticket ${input.sale.displayNumber}` : `Facture ${input.sale.displayNumber}`;
  const text =
    intent === "print" ? undefined : `Voici votre facture ${input.sale.displayNumber}.`;
  const dialogTitle = intent === "print" ? "Imprimer le ticket" : "Partager la facture PDF";

  if (Capacitor.isNativePlatform()) {
    const nativeFile = await Filesystem.writeFile({
      path: `invoices/${fileName}`,
      data: await blobToBase64(blob),
      directory: Directory.Cache,
      recursive: true,
    });
    const supported = await Share.canShare();
    if (!supported.value) {
      throw new Error("Le partage de fichiers n’est pas disponible sur cet appareil.");
    }
    await Share.share({
      title,
      text,
      files: [nativeFile.uri],
      dialogTitle,
    });
    return { fileName, method: "native" };
  }

  const file = new File([blob], fileName, { type: "application/pdf" });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    await navigator.share({ title, text, files: [file] });
    return { fileName, method: "web" };
  }

  downloadPdf(blob, fileName);
  return { fileName, method: "download" };
}
