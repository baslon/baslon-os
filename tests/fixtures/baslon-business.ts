import type {
  BusinessInput,
  ClaimInput,
  EvidenceInput,
  MetricInput,
} from "@/domain/schemas";

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
