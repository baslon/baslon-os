import type {
  BusinessInput,
  ClaimInput,
  EvidenceInput,
  MetricInput,
} from "@/domain/schemas";
import type { EvidenceExtractionOutput } from "@/ai/evidence-extractor/contracts";

export const baslonBusiness: BusinessInput = {
  name: "Baslon Digital",
  sector: "Digital services",
  primaryGeography: "United Kingdom",
  profileData: {
    services: ["websites", "digital strategy"],
    markets_served: ["established service businesses"],
    team_size: null,
    growth_goal: "Fewer, larger strategic clients with stronger recurring revenue",
    founder_hours_target: 30,
    current_acquisition_channels: [
      "referrals", "returning clients", "Baslon website", "Wix Marketplace",
    ],
  },
};

export function baslonClaims(businessId: string): ClaimInput[] {
  return [
    {
      businessId,
      statement: "The business generated approximately £80k annual revenue.",
      claimType: "management_belief",
      subjectArea: "economics",
      confidenceLevel: "medium",
      confidenceBasis: { basis: "founder intake; documentary evidence pending" },
      sourceType: "business_intake",
    },
    {
      businessId,
      statement: "£7.5k should become the core minimum engagement.",
      claimType: "hypothesis",
      subjectArea: "offer",
      confidenceLevel: "low",
      confidenceBasis: { basis: "management aspiration; commercially unvalidated" },
      sourceType: "business_intake",
    },
    {
      businessId,
      statement: "The exact share of revenue from repeat clients is unknown.",
      claimType: "unknown",
      subjectArea: "economics",
      confidenceLevel: "high",
      confidenceBasis: { basis: "explicitly marked unknown" },
      sourceType: "business_intake",
    },
  ];
}

export function baslonEvidence(businessId: string): EvidenceInput {
  return {
    businessId,
    evidenceType: "management_record",
    statement: "Recent meaningful projects ranged from approximately £1k to £6k.",
    valueText: "£1k–£6k",
    sourceType: "business_intake",
    sourceReference: "Baslon Business #001 initial intake",
    sourceMetadata: { suppliedBy: "founder" },
    reliabilityLevel: "medium",
    directnessLevel: "direct",
    recencyLevel: "recent",
    materiality: "high",
  };
}

export function baslonMetric(businessId: string, sourceEvidenceId: string): MetricInput {
  return {
    businessId,
    metricKey: "average_project_value",
    metricLabel: "Recent average meaningful project",
    numericValue: 3200,
    unit: "GBP",
    sourceEvidenceId,
  };
}

export const baslonMessyIntake = `Baslon Digital brought in about £80k over the last year, although that figure is from the founder's notes and still needs checking against the accounts. Recurring revenue is roughly £1.8k a month.

Most worthwhile projects recently landed somewhere between £1k and £6k, with the average around £3.2k. The founder believes referrals and returning clients still bring most of the good work, alongside the Baslon website and Wix Marketplace, but the exact channel split is unknown.

We think £7.5k+ should become the minimum for the main transformation engagement, but that has not been commercially validated. There were around 12 serious opportunities, 6 discovery calls and 3 new projects in the period. The founder wants to work about 30 hours per week. We do not know the exact share of revenue from repeat clients.`;

export const baslonExtractionOutput: EvidenceExtractionOutput = {
  claims: [
    {
      proposalRef: "claim_1",
      statement: "Annual revenue is approximately £80k, pending verification.",
      claimType: "management_belief",
      subjectArea: "economics",
      confidenceLevel: "medium",
      confidenceScore: 0.6,
      confidenceBasis: { basis: "Founder notes; accounts not yet checked" },
      sourceType: "business_intake",
    },
    {
      proposalRef: "claim_2",
      statement: "£7.5k+ should become the minimum transformation engagement.",
      claimType: "hypothesis",
      subjectArea: "offer",
      confidenceLevel: "low",
      confidenceScore: 0.3,
      confidenceBasis: { basis: "Management aspiration; commercially unvalidated" },
      sourceType: "business_intake",
    },
    {
      proposalRef: "claim_3",
      statement: "The exact share of revenue from repeat clients is unknown.",
      claimType: "unknown",
      subjectArea: "economics",
      confidenceLevel: "high",
      confidenceScore: 1,
      confidenceBasis: { basis: "Explicit unknown in intake" },
      sourceType: "business_intake",
    },
  ],
  evidence: [
    {
      proposalRef: "evidence_1",
      evidenceType: "management_record",
      statement: "Founder notes indicate approximately £80k annual revenue.",
      valueNumeric: 80000,
      valuePrecision: "approximate",
      valueLower: null,
      valueUpper: null,
      valueText: "about £80k",
      unit: "GBP",
      periodStart: null,
      periodEnd: null,
      sourceType: "business_intake",
      sourceReference: "Baslon Business #001 messy intake",
      sourceMetadata: { suppliedBy: "founder", notes: "Accounts not yet checked" },
      reliabilityLevel: "medium",
      reliabilityScore: 0.6,
      directnessLevel: "direct",
      recencyLevel: "recent",
      rawPayload: { excerpt: "about £80k over the last year" },
      materiality: "high",
      sourceExcerpt: "about £80k over the last year",
    },
  ],
  metrics: [
    {
      proposalRef: "metric_1",
      metricKey: "annual_revenue",
      metricLabel: "Approximate annual revenue",
      numericValue: 80000,
      numericPrecision: "approximate",
      numericLower: null,
      numericUpper: null,
      unit: "GBP",
      periodStart: null,
      periodEnd: null,
      dimensionData: { dimension: null, value: null },
      sourceEvidenceRef: "evidence_1",
      sourceExcerpt: "about £80k over the last year",
    },
  ],
  relationships: [
    {
      proposalRef: "relationship_1",
      claimRef: "claim_1",
      evidenceRef: "evidence_1",
      relationshipType: "supports",
      strengthScore: 0.6,
    },
  ],
};

function without(record: object, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}

/** The Evidence proposal as stored before M4-02A: no precision fields. */
export const legacyEvidenceProposal = without(
  baslonExtractionOutput.evidence[0],
  ["valuePrecision", "valueLower", "valueUpper"],
);

/** The Metric proposal as stored before M4-02A: no precision fields. */
export const legacyMetricProposal = without(
  baslonExtractionOutput.metrics[0],
  ["numericPrecision", "numericLower", "numericUpper"],
);
