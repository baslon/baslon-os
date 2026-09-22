import type { Database } from "@/db/client";
import type { Phase1DiagnosisModel } from "@/ai/phase1-diagnosis/model";
import type { Phase1DiagnosisModelInput, Phase1DiagnosisOutput } from "@/ai/phase1-diagnosis/contracts";
import { EvidenceCoherenceRepository } from "@/repositories/evidence-coherence-repository";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { Phase1DiagnosisRepository } from "@/repositories/phase1-diagnosis-repository";
import { createStrategyOrchestrator } from "@/repositories/workflow-repository";
import { EvidenceCoherenceService } from "@/services/evidence-coherence-service";
import { GapResolutionService } from "@/services/gap-resolution-service";
import { Phase1DiagnosisService } from "@/services/phase1-diagnosis-service";

/** Synthetic data only: never a real Business. */
export const REVENUE_STATEMENT = "Total revenue was approximately £240,000 in the last 12 months.";
export const PROFIT_GAP_STATEMENT = "Reliable profit figures are unavailable.";

export class FakeDiagnosisModel implements Phase1DiagnosisModel {
  calls = 0;
  inputs: Phase1DiagnosisModelInput[] = [];
  constructor(private readonly factory: (input: Phase1DiagnosisModelInput) => unknown) {}
  getConfiguration() { return { provider: "fake", model: "diagnosis-test", metadata: { deterministic: true } }; }
  async analyse(input: Phase1DiagnosisModelInput) {
    this.calls += 1;
    this.inputs.push(structuredClone(input));
    const output = this.factory(input);
    return { output, rawOutput: output };
  }
}

export function handleOf(input: Phase1DiagnosisModelInput, statement: string) {
  const record = [...input.snapshot.claims, ...input.snapshot.evidence].find((item) => item.statement === statement);
  if (!record) throw new Error(`No handle for ${statement}`);
  return record.handle;
}

/** A valid diagnosis citing records by handle only. */
export function validDiagnosis(input: Phase1DiagnosisModelInput): Phase1DiagnosisOutput {
  return {
    items: [
      {
        itemType: "position",
        statement: "Revenue for the last 12 months was approximately £240,000.",
        rationale: "The revenue evidence states an approximate annual figure.",
        grounding: "evidence_backed",
        materiality: "high",
        interpretationConfidence: "high",
        limitations: null,
        references: [{ entityType: "evidence", ref: handleOf(input, REVENUE_STATEMENT), role: "primary" }],
      },
      {
        itemType: "limitation",
        statement: "Profitability cannot be established from the current snapshot.",
        rationale: "No reliable cost or profit figures exist.",
        grounding: "interpretive",
        materiality: "high",
        interpretationConfidence: "medium",
        limitations: "Cost and profit data are untracked.",
        references: [
          { entityType: "evidence", ref: handleOf(input, PROFIT_GAP_STATEMENT), role: "context" },
          { entityType: "gap", ref: "G001", role: "limiting_gap" },
        ],
      },
      {
        itemType: "strength",
        statement: "Recurring revenue runs at approximately £14,400 a year.",
        rationale: "The software run-rate calculation annualises the recurring monthly figure.",
        grounding: "calculated",
        materiality: "medium",
        interpretationConfidence: null,
        limitations: null,
        references: [{ entityType: "calculation", ref: "D001", role: "primary" }],
      },
    ],
  };
}

/** Synthetic Business taken through evidence, coherence and CONTINUE_WITH_GAPS to PHASE1_READY. */
export async function phase1ReadyBusiness(database: Database, name: string) {
  const foundation = new FoundationRepository(database);
  const business = await foundation.createBusiness({ name: `${name} (synthetic test)`, profileData: {} });
  const claim = await foundation.addClaim({
    businessId: business.id, statement: "Revenue is concentrated in one-off projects.",
    claimType: "management_belief", subjectArea: "finance", confidenceLevel: "medium", sourceType: "test",
  });
  const revenue = await foundation.addEvidence({
    businessId: business.id, evidenceType: "revenue", statement: REVENUE_STATEMENT,
    valueNumeric: 240000, valuePrecision: "approximate", unit: "GBP", sourceType: "test",
    reliabilityLevel: "medium", directnessLevel: "direct", recencyLevel: "current", materiality: "high",
  });
  const profitGap = await foundation.addEvidence({
    businessId: business.id, evidenceType: "profitability_data_gap", statement: PROFIT_GAP_STATEMENT,
    sourceType: "test", reliabilityLevel: "medium", directnessLevel: "direct", recencyLevel: "current", materiality: "high",
  });
  const recurring = await foundation.addEvidence({
    businessId: business.id, evidenceType: "recurring_revenue", statement: "Recurring revenue is approximately £1,200 per month.",
    valueNumeric: 1200, valuePrecision: "approximate", unit: "GBP per month", sourceType: "test",
    reliabilityLevel: "medium", directnessLevel: "direct", recencyLevel: "current", materiality: "medium",
  });
  const metric = await foundation.addMetric({
    businessId: business.id, metricKey: "recurring_monthly_revenue", metricLabel: "Recurring monthly revenue",
    numericValue: 1200, numericPrecision: "approximate", unit: "GBP per month", sourceEvidenceId: recurring.id,
  });
  await foundation.linkClaimEvidence({ claimId: claim.id, evidenceId: revenue.id, relationshipType: "context", strengthScore: 0.6 });
  const snapshot = await foundation.createSnapshot(business.id);
  const orchestrator = createStrategyOrchestrator(database);
  for (const [event, actorType] of [
    ["START_INTAKE", "human"], ["SUBMIT_INTAKE", "human"],
    ["PROCESS_EVIDENCE", "system"], ["MARK_ANALYSIS_COMPLETE", "system"],
  ] as const) await orchestrator.transition({ businessId: business.id, event, actorType, actorId: "test" });
  const coherence = new EvidenceCoherenceRepository(database);
  const coherenceRun = await new EvidenceCoherenceService(coherence, {
    getConfiguration: () => ({ provider: "fake", model: "coherence", metadata: {} }),
    analyse: async () => {
      const output = {
        contradictions: [],
        gaps: [
          { findingRef: "gap_1", area: "financial_performance", missingInformation: "Costs and profit are untracked.", decisionImpact: "Profitability cannot be assessed.", materiality: "high", priorityRank: 1, references: [{ entityType: "evidence", ref: "E002", role: "primary" }] },
          { findingRef: "gap_2", area: "marketing_and_acquisition", missingInformation: "Channel data is untracked.", decisionImpact: "Channel efficiency cannot be compared.", materiality: "medium", priorityRank: 2, references: [] },
        ],
        questions: [],
      };
      return { output, rawOutput: output };
    },
  }, orchestrator).analyseCurrentSnapshot({ businessId: business.id });
  await new GapResolutionService(coherence, orchestrator).continueWithGaps({ businessId: business.id });
  return { business, claim, revenue, profitGap, recurring, metric, snapshot, orchestrator, coherenceRun: coherenceRun.run };
}

export function diagnosisService(database: Database, model: Phase1DiagnosisModel, orchestrator = createStrategyOrchestrator(database)) {
  return new Phase1DiagnosisService(new Phase1DiagnosisRepository(database), model, orchestrator);
}
