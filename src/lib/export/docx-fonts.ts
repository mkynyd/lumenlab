import { readFile } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { Document, Packer, Paragraph } from "docx";
import { DOCX_CHINESE_FONT } from "./docx-styles";

let fontPackage: Promise<Buffer> | undefined;

/** Use docx's OOXML font embedding/obfuscation rather than relying on host fonts.
 * The bundled Noto font has OS/2 fsType=0 and is distributed under the OFL.
 */
export async function embedChineseDocxFont(buffer: Buffer): Promise<Buffer> {
  fontPackage ??= readFile(path.join(process.cwd(), "assets/export/NotoSansSC-Regular.ttf"))
    .then((data) => Packer.toBuffer(new Document({
      fonts: [{ name: DOCX_CHINESE_FONT, data }],
      sections: [{ children: [new Paragraph("")] }],
    })))
    .catch((error) => { fontPackage = undefined; throw error; });
  const donor = new AdmZip(await fontPackage);
  const document = new AdmZip(buffer);
  for (const name of ["word/fontTable.xml", "word/_rels/fontTable.xml.rels", "word/fonts/font1.odttf"]) {
    const data = donor.readFile(name)!;
    // Use canonical OOXML GUIDs and omit the donor’s Latin-only font signature.
    document.addFile(name, name === "word/fontTable.xml"
      ? Buffer.from(data.toString("utf8").replace(/w:fontKey="([^"{}]+)"/g, 'w:fontKey="{$1}"').replace(/<w:sig[^>]*\/>/g, ""))
      : data);
  }
  let types = document.readAsText("[Content_Types].xml");
  if (!types.includes('Extension="odttf"')) {
    types = types.replace("</Types>", '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/></Types>');
    document.updateFile("[Content_Types].xml", Buffer.from(types));
  }
  const relPath = "word/_rels/document.xml.rels";
  let relationships = document.readAsText(relPath);
  if (!relationships.includes('/relationships/fontTable"')) {
    relationships = relationships.replace("</Relationships>", '<Relationship Id="rIdLumenFontTable" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/></Relationships>');
    document.updateFile(relPath, Buffer.from(relationships));
  }
  return document.toBuffer();
}
