/** Run with NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local scripts/study-bank-publish.ts manifest.json --verified */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { prisma } from "../src/lib/db";
import { uploadObjectBuffer, deleteStoredObject, type StoredObjectRef } from "../src/lib/storage/object-storage";
import { solutionSchema } from "../src/lib/study/contracts";
const schema = z.object({ title: z.string().min(1).max(200), stage: z.enum(["primary", "secondary", "university", "professional", "other"]), subject: z.string().min(1), exam: z.string(), year: z.number().int().min(1900).max(2200), sourceUrl: z.url().refine(url => /^https?:/.test(url)), license: z.string().min(1), questions: z.array(z.object({ ordinal: z.string().min(1), prompt: z.string().min(1).max(200000), solution: solutionSchema, illustrations: z.array(z.string().min(1)).max(32).default([]) }).strict()).min(1).max(5000) }).strict();
async function main() {
  const filename = process.argv[2];
  if (!filename || process.argv[3] !== "--verified") throw new Error("需要本地manifest.json与--verified，确认题干、图、答案及授权已经人工核验");
  const input = schema.parse(JSON.parse(await readFile(filename, "utf8")));
  if (new Set(input.questions.map(q => q.ordinal)).size !== input.questions.length) throw new Error("原题号重复");
  const paperId = randomUUID(), stored: StoredObjectRef[] = [];
  await prisma.bankPaper.create({ data: { id: paperId, title: input.title, stage: input.stage, subject: input.subject, exam: input.exam, year: input.year, sourceUrl: input.sourceUrl, license: input.license } });
  try {
    for (const [questionIndex, question] of input.questions.entries()) {
      const id = `${paperId}-${String(questionIndex).padStart(5, "0")}`, assets: StoredObjectRef[] = [];
      for (const [index, filenameImage] of question.illustrations.entries()) {
        const raw = await readFile(path.resolve(path.dirname(filename), filenameImage));
        const buffer = await sharp(raw, { limitInputPixels: 40000000 }).png().toBuffer();
        if (buffer.length > 20 * 1024 * 1024) throw new Error("插图过大");
        const asset = await uploadObjectBuffer({ key: `study/bank/${paperId}/${id}/${index}.png`, mimeType: "image/png", buffer });
        stored.push(asset); assets.push({ provider: asset.provider, key: asset.key });
      }
      await prisma.bankQuestion.create({ data: { id, paperId, ordinal: question.ordinal, prompt: question.prompt, solution: question.solution, assets: assets.map(asset => ({ provider: asset.provider, key: asset.key })), verified: true, contentHash: createHash("sha256").update(question.prompt.normalize("NFC").replace(/\s+/g, " ").trim()).digest("hex") } });
    }
    await prisma.bankPaper.update({ where: { id: paperId }, data: { verified: true } });
    console.log(JSON.stringify({ paperId, questions: input.questions.length, published: true }));
  } catch (error) {
    await prisma.bankPaper.delete({ where: { id: paperId } });
    await Promise.allSettled(stored.map(deleteStoredObject));
    throw error;
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "题库发布失败"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
