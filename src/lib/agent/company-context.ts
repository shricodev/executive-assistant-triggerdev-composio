import { readFile } from "node:fs/promises";
import path from "node:path";

export const COMPANY_DOCUMENTS = {
  company: {
    title: "Company and product overview",
    description: "What Larkspur Notes does, product facts, limits, security and the team.",
  },
  pricing: {
    title: "Pricing",
    description: "Plans, prices, included usage, discounts and billing rules.",
  },
  policies: {
    title: "Email and meeting policies",
    description: "How to reply, how to schedule meetings, escalation and refund rules.",
  },
} as const;

export type DocumentId = keyof typeof COMPANY_DOCUMENTS;

export const DOCUMENT_IDS = Object.keys(COMPANY_DOCUMENTS) as [DocumentId, ...DocumentId[]];

export async function readCompanyDocument(id: DocumentId): Promise<string> {
  return readFile(path.join(process.cwd(), "demo-data", `${id}.md`), "utf8");
}
