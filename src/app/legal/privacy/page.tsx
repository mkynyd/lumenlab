import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { readLegalDocument } from "@/lib/legal-documents";

export const metadata: Metadata = {
  title: "隐私政策",
};

export default function PrivacyPage() {
  return <LegalDocument content={readLegalDocument("privacy")} />;
}
