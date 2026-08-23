import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import {
  mapTemplateRuntimeStatus,
  parseTemplateRegistry,
} from "@/lib/paper/template-registry";

const root = process.env.TEMPLATE_REGISTRY_ROOT
  ? path.resolve(process.env.TEMPLATE_REGISTRY_ROOT)
  : path.resolve(process.cwd(), "../cn-thesis-templates");

async function main() {
  const raw = JSON.parse(await fs.readFile(path.join(root, "templates.json"), "utf8")) as unknown;
  const records = parseTemplateRegistry(raw);
  if (process.env.TEMPLATE_REGISTRY_DRY_RUN === "1") {
    const byFormat = Object.fromEntries(
      [...new Set(records.map((record) => record.format))].map((format) => [
        format,
        records.filter((record) => record.format === format).length,
      ])
    );
    console.log(JSON.stringify({ root, imported: records.length, byFormat }));
    return;
  }
  const counts = new Map<string, number>();

  for (const record of records) {
    const runtimeStatus = mapTemplateRuntimeStatus(record);
    counts.set(runtimeStatus, (counts.get(runtimeStatus) ?? 0) + 1);
    await prisma.templateRegistryEntry.upsert({
      where: { externalId: record.id },
      create: {
        externalId: record.id,
        university: record.university,
        universityType: record.universityType,
        degreeType: record.degreeType,
        year: record.year,
        format: record.format,
        sourceType: record.sourceType,
        officialSpecUrl: record.officialSpecUrl,
        repositoryUrl: record.repositoryUrl,
        repositoryHost: record.repositoryHost,
        sourceVersion: record.version ?? record.lastCommit,
        engine: record.engine,
        entryFile: record.entryFile,
        documentClass: record.documentClass,
        bibliography: record.bibliography,
        license: record.license,
        recommendationLevel: record.recommendationLevel,
        status: runtimeStatus,
        metadata: JSON.parse(JSON.stringify(record)),
      },
      update: {
        university: record.university,
        universityType: record.universityType,
        degreeType: record.degreeType,
        year: record.year,
        format: record.format,
        sourceType: record.sourceType,
        officialSpecUrl: record.officialSpecUrl,
        repositoryUrl: record.repositoryUrl,
        repositoryHost: record.repositoryHost,
        sourceVersion: record.version ?? record.lastCommit,
        engine: record.engine,
        entryFile: record.entryFile,
        documentClass: record.documentClass,
        bibliography: record.bibliography,
        license: record.license,
        recommendationLevel: record.recommendationLevel,
        status: runtimeStatus,
        metadata: JSON.parse(JSON.stringify(record)),
      },
    });

    const executable = ["latex", "overleaf", "typst"].includes(record.format.toLowerCase());
    if (executable) {
      await prisma.templateVariant.upsert({
        where: { variantKey: `${record.id}:default` },
        create: {
          registryEntry: { connect: { externalId: record.id } },
          variantKey: `${record.id}:default`,
          manifest: {
            id: `${record.id}:default`,
            university: record.university,
            degreeType: record.degreeType,
            year: record.year,
            format: record.format,
            officialSpecUrl: record.officialSpecUrl,
            repositoryUrl: record.repositoryUrl,
            engine: record.engine,
            entryFile: record.entryFile,
            documentClass: record.documentClass,
            bibliography: record.bibliography,
            supportedBlocks: ["metadata", "abstract", "heading", "paragraph", "figure", "table", "equation", "citation", "appendix"],
          },
          pinnedUpstreamSnapshot: {
            repositoryUrl: record.repositoryUrl,
            commitOrVersion: record.version ?? record.lastCommit,
            sourceType: record.sourceType,
          },
          adapterId: `${record.format.toLowerCase()}-academic-v1`,
          status: runtimeStatus,
          validation: { status: "pending", lastValidatedAt: null },
        },
        update: {
          manifest: {
            id: `${record.id}:default`,
            university: record.university,
            degreeType: record.degreeType,
            year: record.year,
            format: record.format,
            officialSpecUrl: record.officialSpecUrl,
            repositoryUrl: record.repositoryUrl,
            engine: record.engine,
            entryFile: record.entryFile,
            documentClass: record.documentClass,
            bibliography: record.bibliography,
            supportedBlocks: ["metadata", "abstract", "heading", "paragraph", "figure", "table", "equation", "citation", "appendix"],
          },
          pinnedUpstreamSnapshot: {
            repositoryUrl: record.repositoryUrl,
            commitOrVersion: record.version ?? record.lastCommit,
            sourceType: record.sourceType,
          },
          status: runtimeStatus,
        },
      });
    }
  }

  console.log(JSON.stringify({ root, imported: records.length, runtimeStatuses: Object.fromEntries(counts) }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
