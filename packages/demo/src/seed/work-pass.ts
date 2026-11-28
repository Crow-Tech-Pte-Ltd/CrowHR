import { PDFDocument, StandardFonts } from "pdf-lib";

/** A fictional attachment for the demo document register. */
export async function workPassPdf(expiresOn: string): Promise<Uint8Array> {
  const expiry = new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${expiresOn}T00:00:00Z`));

  const pdf = await PDFDocument.create();
  pdf.setTitle("Fictional demo work pass");
  const page = pdf.addPage([420, 280]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);

  page.drawText("FICTIONAL DEMO WORK PASS", { x: 36, y: 219, size: 18, font: bold });
  page.drawText("DEMO ONLY", { x: 36, y: 194, size: 11, font: bold });

  page.drawText("Employee: Maria", { x: 36, y: 147, size: 12, font: regular });
  page.drawText(`Sample expiry date: ${expiry}`, { x: 36, y: 126, size: 12, font: regular });

  page.drawText("Made for the Crow HR demo.", { x: 36, y: 79, size: 11, font: regular });
  page.drawText("This document has no official validity.", { x: 36, y: 61, size: 11, font: regular });

  return pdf.save();
}
