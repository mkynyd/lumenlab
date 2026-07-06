export type DocumentBlock =
  | TextBlock
  | HeadingBlock
  | TableBlock
  | FormulaBlock
  | ImageBlock
  | CodeBlock
  | PageBreakBlock;

export interface BaseBlock {
  type: DocumentBlock["type"];
  id: string;
  pageNumber?: number;
  slideNumber?: number;
}

export interface TextBlock extends BaseBlock { type: "text"; content: string; }
export interface HeadingBlock extends BaseBlock { type: "heading"; level: number; content: string; }
export interface TableBlock extends BaseBlock { type: "table"; markdown: string; caption?: string; }
export interface FormulaBlock extends BaseBlock { type: "formula"; content: string; }
export interface ImageBlock extends BaseBlock {
  type: "image";
  assetId: string;
  relativePath: string;
  altText?: string;
  surroundingText?: string;
  visionText?: string;
  visionSummary?: string;
  extractedText?: string;
  confidence?: number;
  analysisStatus: "pending" | "skipped" | "parsed" | "failed";
  skipReason?: string;
}
export interface CodeBlock extends BaseBlock { type: "code"; language?: string; content: string; }
export interface PageBreakBlock extends BaseBlock { type: "page-break"; }

export interface ParsedAsset {
  id: string;
  relativePath: string;
  mimeType: string;
  buffer: Buffer;
  sha256: string;
}

export interface ParseInput {
  userId: string;
  fileAssetId: string;
  filename: string;
  mimeType: string;
  data: Buffer;
  apiKeys: { minimax?: string; mineru?: string; bailian?: string; };
}

export type ProgressCallback = (stage: string, progress?: { current: number; total: number }) => void;

export interface ParseResult {
  blocks: DocumentBlock[];
  assets: ParsedAsset[];
  metadata: ParsingMetadata;
}

export interface ParsingMetadata {
  parser: string;
  pipelineVersion: string;
  sourceKind: string;
  requiresVisionModel: boolean;
  assetCount: number;
  parseStartedAt: string;
  parseCompletedAt: string;
  parseWarnings: string[];
  strategy?: string;
}

export interface DocumentParser {
  readonly parserId: string;
  readonly sourceKind: string;
  canParse(input: ParseInput): boolean;
  parse(input: ParseInput, onProgress?: ProgressCallback): Promise<ParseResult>;
}
