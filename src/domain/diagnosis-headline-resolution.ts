import { diagnosisContractForArtifact } from "@/domain/phase1-diagnosis-versions";

/**
 * Which reviewed headlines an approved diagnosis is shown with. Resolution is
 * deterministic and read-only: a `phase1_diagnosis_v2` diagnosis carries its own
 * reviewed headlines; a v1 diagnosis may be labelled by a companion headline set
 * approved for that exact diagnosis; otherwise there is no headline and the
 * approved statement leads. Nothing is generated at render time and no headline
 * is ever matched by text.
 */
export type ApprovedHeadlineResolution = {
  source: "native" | "companion" | "none";
  setId?: string;
  setVersion?: number;
  approvedBy?: string;
  approvedAt?: string;
  byItemRef: Record<string, string>;
};

type ApprovedDiagnosis = {
  id: string;
  version: number;
  analysisRunId: string;
  artifactVersion: string;
  content: Record<string, unknown>;
};

type CompanionHeadlineSet = {
  id: string;
  businessId: string;
  approvedDiagnosisId: string;
  approvedDiagnosisVersion: number;
  diagnosisRunId: string;
  version: number;
  approvedBy: string;
  approvedAt: Date;
  headlines: Array<{ itemRef: string; headline: string }>;
};

export function resolveApprovedHeadlines(input: {
  businessId: string;
  approved: ApprovedDiagnosis;
  companion?: CompanionHeadlineSet;
}): ApprovedHeadlineResolution {
  const contract = diagnosisContractForArtifact(input.approved.artifactVersion);
  if (contract.hasHeadline) {
    const items = (input.approved.content.items ?? []) as Array<{ itemRef?: string; headline?: string }>;
    return {
      source: "native",
      byItemRef: Object.fromEntries(items
        .filter((item) => item.itemRef && item.headline)
        .map((item) => [item.itemRef!, item.headline!])),
    };
  }
  const companion = input.companion;
  // Exact binding only: same Business, same approved diagnosis, same approved
  // version, same diagnosis run. A set for anything else is stale and ignored.
  const bound = companion
    && companion.businessId === input.businessId
    && companion.approvedDiagnosisId === input.approved.id
    && companion.approvedDiagnosisVersion === input.approved.version
    && companion.diagnosisRunId === input.approved.analysisRunId;
  if (!bound) return { source: "none", byItemRef: {} };
  return {
    source: "companion",
    setId: companion.id,
    setVersion: companion.version,
    approvedBy: companion.approvedBy,
    approvedAt: companion.approvedAt.toISOString(),
    byItemRef: Object.fromEntries(companion.headlines.map((headline) => [headline.itemRef, headline.headline])),
  };
}
