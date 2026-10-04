import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Exercise the deployed package, including PDF.js's dynamic worker import.
// A build alone can pass while standalone has no worker at runtime.
const base = path.join(process.cwd(), ".next/standalone/node_modules/pdfjs-dist/legacy/build");
await Promise.all(["pdf.mjs", "pdf.worker.mjs"].map(file => access(path.join(base, file))));
const { getDocument } = await import(pathToFileURL(path.join(base, "pdf.mjs")).href);
const stream = "BT /F1 12 Tf 20 50 Td (Release check) Tj ET";
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
];
let pdf = "%PDF-1.4\n";
const offsets = [0];
for (const [index, object] of objects.entries()) {
  offsets.push(pdf.length);
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
}
const xref = pdf.length;
pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const document = await getDocument({
  data: new Uint8Array(Buffer.from(pdf)),
  standardFontDataUrl: path.join(process.cwd(), "public/pdfjs/standard_fonts") + path.sep,
}).promise;
try {
  const content = await (await document.getPage(1)).getTextContent();
  if (document.numPages !== 1 || !content.items.some(item => "str" in item && item.str === "Release check")) {
    throw new Error("Standalone PDF.js did not preserve the test document");
  }
  console.log("[pdfjs-runtime] standalone document and worker passed");
} finally {
  await document.destroy();
}
