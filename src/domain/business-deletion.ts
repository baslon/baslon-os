import { z } from "zod";

export const permanentDeleteBusinessSchema = z.object({
  businessId: z.uuid(),
  confirmation: z.string(),
}).strict();

export type DeletionConfirmationBusiness = {
  id: string;
  name: string;
  websiteUrl: string | null;
  legalName: string | null;
  primaryGeography: string | null;
  profileData: Record<string, unknown>;
  status: string;
  archivedAt: Date | null;
};

export type BusinessDeletionConfirmation = {
  phrase: string;
  duplicateName: boolean;
  disambiguator: string | null;
  reference: string | null;
};

export class BusinessDeletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessDeletionError";
  }
}

export function displayDomain(value: string | null): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return value.trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "") || null;
  }
}

function uniqueCandidate(
  targetValue: string | null,
  others: DeletionConfirmationBusiness[],
  value: (business: DeletionConfirmationBusiness) => string | null,
) {
  return targetValue && others.every((business) => value(business) !== targetValue)
    ? targetValue
    : null;
}

function stableProfileReference(business: DeletionConfirmationBusiness): string | null {
  for (const key of ["company_number", "registration_number"] as const) {
    const value = business.profileData[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function compactReference(targetId: string, sameNameBusinesses: DeletionConfirmationBusiness[]) {
  const compactIds = sameNameBusinesses.map((business) => ({
    id: business.id,
    compact: business.id.replaceAll("-", "").toUpperCase(),
  }));
  const target = compactIds.find((item) => item.id === targetId);
  if (!target) throw new Error("Target Business is missing from its same-name set");
  for (let length = 8; length <= target.compact.length; length += 1) {
    const reference = target.compact.slice(0, length);
    if (compactIds.every((item) => item.id === targetId || item.compact.slice(0, length) !== reference)) {
      return reference;
    }
  }
  throw new Error("A unique Business reference could not be generated");
}

export function deriveBusinessDeletionConfirmation(
  target: DeletionConfirmationBusiness,
  sameNameBusinesses: DeletionConfirmationBusiness[],
): BusinessDeletionConfirmation {
  const matching = sameNameBusinesses.filter((business) => business.name === target.name);
  if (!matching.some((business) => business.id === target.id)) matching.push(target);
  if (matching.length === 1) {
    return { phrase: target.name, duplicateName: false, disambiguator: null, reference: null };
  }

  const others = matching.filter((business) => business.id !== target.id);
  const candidates = [
    uniqueCandidate(displayDomain(target.websiteUrl), others, (business) => displayDomain(business.websiteUrl)),
    uniqueCandidate(target.legalName?.trim() || null, others, (business) => business.legalName?.trim() || null),
    uniqueCandidate(target.primaryGeography?.trim() || null, others, (business) => business.primaryGeography?.trim() || null),
    uniqueCandidate(stableProfileReference(target), others, stableProfileReference),
  ];
  const disambiguator = candidates.find((candidate): candidate is string => Boolean(candidate));
  if (disambiguator) {
    return {
      phrase: `${target.name} — ${disambiguator}`,
      duplicateName: true,
      disambiguator,
      reference: null,
    };
  }

  const reference = compactReference(target.id, matching);
  return {
    phrase: `${target.name} — Ref ${reference}`,
    duplicateName: true,
    disambiguator: null,
    reference,
  };
}
