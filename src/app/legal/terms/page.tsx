import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { readLegalDocument } from "@/lib/legal-documents";

export const metadata: Metadata = {
  title: "用户协议",
};

export default function TermsPage() {
  return <LegalDocument content={readLegalDocument("terms")} />;
}
