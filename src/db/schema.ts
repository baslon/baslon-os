import { relations, sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const claimType = pgEnum("claim_type", [
  "fact", "observation", "management_belief", "hypothesis",
  "ai_inference", "unknown", "decision",
]);
export const relationshipType = pgEnum("claim_evidence_relationship", [
  "supports", "contradicts", "context",
]);
export const workflowState = pgEnum("workflow_state", [
  "NEW", "INTAKE_IN_PROGRESS", "INTAKE_READY", "EVIDENCE_PROCESSING",
  "EVIDENCE_READY", "GAP_ANALYSIS", "GAP_RESOLUTION_REQUIRED",
  "PHASE1_READY", "PHASE1_ANALYSING", "PHASE1_AWAITING_REVIEW",
  "REVISION_REQUIRED", "PHASE1_APPROVED",
]);
export const workflowEvent = pgEnum("workflow_event", [
  "START_INTAKE", "SUBMIT_INTAKE", "ADD_EVIDENCE", "MARK_UNKNOWN",
  "CONTINUE_WITH_GAPS", "GENERATE_PHASE1", "APPROVE_PHASE1",
  "REQUEST_REVISION", "REJECT_PHASE1", "PROCESS_EVIDENCE",
  "RUN_GAP_ANALYSIS", "MARK_ANALYSIS_COMPLETE",
]);
export const actorType = pgEnum("actor_type", ["human", "system", "ai"]);
export const evidenceExtractionRunStatus = pgEnum("evidence_extraction_run_status", [
  "RUNNING", "SUCCEEDED", "FAILED",
]);
export const evidenceProposalType = pgEnum("evidence_proposal_type", [
  "claim", "evidence", "metric", "claim_evidence",
]);
export const evidenceReviewSessionStatus = pgEnum("evidence_review_session_status", [
  "OPEN", "COMPLETED",
]);
export const evidenceReviewDecision = pgEnum("evidence_review_decision", [
  "ACCEPTED", "CORRECTED", "REJECTED", "UNRESOLVED",
]);
export const reviewCanonicalEntityType = pgEnum("review_canonical_entity_type", [
  "claim", "evidence", "metric", "claim_evidence",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const businesses = pgTable("businesses", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  websiteUrl: text("website_url"),
  sector: text("sector"),
  status: text("status").default("active").notNull(),
  primaryGeography: text("primary_geography"),
  ...timestamps,
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [index("businesses_status_idx").on(table.status)]);

export const businessProfiles = pgTable("business_profiles", {
  businessId: uuid("business_id").primaryKey().references(() => businesses.id, { onDelete: "restrict" }),
  profileData: jsonb("profile_data").$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps,
});

export const evidenceExtractionRuns = pgTable("evidence_extraction_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "restrict" }),
  rawIntakeText: text("raw_intake_text").notNull(),
  sourceType: text("source_type"),
  sourceReference: text("source_reference"),
  sourceMetadata: jsonb("source_metadata").$type<Record<string, unknown>>().default({}).notNull(),
  promptVersion: text("prompt_version").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  modelConfiguration: jsonb("model_configuration").$type<Record<string, unknown>>().default({}).notNull(),
  status: evidenceExtractionRunStatus("status").default("RUNNING").notNull(),
  rawModelOutput: jsonb("raw_model_output").$type<unknown>(),
  validationErrors: jsonb("validation_errors").$type<unknown[]>().default([]).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("evidence_extraction_runs_business_idx").on(table.businessId, table.createdAt),
  unique("evidence_extraction_runs_id_business_unique").on(table.id, table.businessId),
]);

export const evidenceProposals = pgTable("evidence_proposals", {
  id: uuid("id").defaultRandom().primaryKey(),
  extractionRunId: uuid("extraction_run_id").notNull(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "restrict" }),
  proposalRef: text("proposal_ref").notNull(),
  proposalType: evidenceProposalType("proposal_type").notNull(),
  structuredPayload: jsonb("structured_payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("evidence_proposals_run_ref_unique").on(table.extractionRunId, table.proposalRef),
  unique("evidence_proposals_id_business_run_unique").on(
    table.id,
    table.businessId,
    table.extractionRunId,
  ),
  index("evidence_proposals_business_idx").on(table.businessId, table.createdAt),
  foreignKey({
    columns: [table.extractionRunId, table.businessId],
    foreignColumns: [evidenceExtractionRuns.id, evidenceExtractionRuns.businessId],
    name: "evidence_proposals_run_same_business_fk",
  }).onDelete("restrict"),
]);

export const claims = pgTable("claims", {
  id: uuid("id").defaultRandom().primaryKey(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "restrict" }),
  statement: text("statement").notNull(),
  claimType: claimType("claim_type").notNull(),
  subjectArea: text("subject_area").notNull(),
  status: text("status").default("active").notNull(),
  confidenceLevel: text("confidence_level").notNull(),
  confidenceScore: numeric("confidence_score", { precision: 5, scale: 4 }),
  confidenceBasis: jsonb("confidence_basis").$type<Record<string, unknown>>().default({}).notNull(),
  sourceType: text("source_type").notNull(),
  ...timestamps,
  supersededByClaimId: uuid("superseded_by_claim_id"),
}, (table) => [
  index("claims_business_idx").on(table.businessId),
  unique("claims_id_business_unique").on(table.id, table.businessId),
  foreignKey({
    columns: [table.supersededByClaimId, table.businessId],
    foreignColumns: [table.id, table.businessId],
    name: "claims_superseded_same_business_fk",
  }).onDelete("restrict"),
  check("claims_confidence_score_check", sql`${table.confidenceScore} is null or (${table.confidenceScore} >= 0 and ${table.confidenceScore} <= 1)`),
  check("claims_fact_admission_audit_check", sql`
    ${table.claimType} <> 'fact' or (
      ${table.confidenceBasis} @> '{"factAdmission":{"actorType":"human"}}'::jsonb
      and jsonb_typeof(${table.confidenceBasis} #> '{factAdmission,supportingEvidenceIds}') = 'array'
      and jsonb_array_length(${table.confidenceBasis} #> '{factAdmission,supportingEvidenceIds}') > 0
    )
  `),
]);

export const evidence = pgTable("evidence", {
  id: uuid("id").defaultRandom().primaryKey(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "restrict" }),
  evidenceType: text("evidence_type").notNull(),
  statement: text("statement").notNull(),
  valueNumeric: numeric("value_numeric", { precision: 20, scale: 4 }),
  valueText: text("value_text"),
  unit: text("unit"),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  sourceType: text("source_type").notNull(),
  sourceReference: text("source_reference"),
  sourceMetadata: jsonb("source_metadata").$type<Record<string, unknown>>().default({}).notNull(),
  reliabilityLevel: text("reliability_level").notNull(),
  reliabilityScore: numeric("reliability_score", { precision: 5, scale: 4 }),
  directnessLevel: text("directness_level").notNull(),
  recencyLevel: text("recency_level").notNull(),
  rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().default({}).notNull(),
  materiality: text("materiality").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("evidence_business_idx").on(table.businessId),
  unique("evidence_id_business_unique").on(table.id, table.businessId),
  check("evidence_period_check", sql`${table.periodEnd} is null or ${table.periodStart} is null or ${table.periodEnd} >= ${table.periodStart}`),
  check("evidence_reliability_score_check", sql`${table.reliabilityScore} is null or (${table.reliabilityScore} >= 0 and ${table.reliabilityScore} <= 1)`),
]);

export const claimEvidence = pgTable("claim_evidence", {
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "restrict" }),
  claimId: uuid("claim_id").notNull(),
  evidenceId: uuid("evidence_id").notNull(),
  relationshipType: relationshipType("relationship_type").notNull(),
  strengthScore: numeric("strength_score", { precision: 5, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.claimId, table.evidenceId, table.relationshipType] }),
  foreignKey({
    columns: [table.claimId, table.businessId],
    foreignColumns: [claims.id, claims.businessId],
    name: "claim_evidence_claim_same_business_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.evidenceId, table.businessId],
    foreignColumns: [evidence.id, evidence.businessId],
    name: "claim_evidence_evidence_same_business_fk",
  }).onDelete("restrict"),
  check("claim_evidence_strength_check", sql`${table.strengthScore} is null or (${table.strengthScore} >= 0 and ${table.strengthScore} <= 1)`),
]);

export const metrics = pgTable("metrics", {
  id: uuid("id").defaultRandom().primaryKey(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "restrict" }),
  metricKey: text("metric_key").notNull(),
  metricLabel: text("metric_label").notNull(),
  numericValue: numeric("numeric_value", { precision: 20, scale: 4 }).notNull(),
  unit: text("unit").notNull(),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  dimensionData: jsonb("dimension_data").$type<Record<string, unknown>>().default({}).notNull(),
  sourceEvidenceId: uuid("source_evidence_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("metrics_business_key_idx").on(table.businessId, table.metricKey),
  foreignKey({
    columns: [table.sourceEvidenceId, table.businessId],
    foreignColumns: [evidence.id, evidence.businessId],
    name: "metrics_source_evidence_same_business_fk",
  }).onDelete("restrict"),
  check("metrics_period_check", sql`${table.periodEnd} is null or ${table.periodStart} is null or ${table.periodEnd} >= ${table.periodStart}`),
]);

export const businessStateSnapshots = pgTable("business_state_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "restrict" }),
  version: integer("version").notNull(),
  snapshotData: jsonb("snapshot_data").$type<Record<string, unknown>>().notNull(),
  createdFromAnalysisRunId: uuid("created_from_analysis_run_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("business_state_snapshots_business_version_unique").on(table.businessId, table.version),
  unique("business_state_snapshots_id_business_unique").on(table.id, table.businessId),
  check("business_state_snapshots_version_check", sql`${table.version} > 0`),
]);

export const evidenceReviewSessions = pgTable("evidence_review_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "restrict" }),
  extractionRunId: uuid("extraction_run_id").notNull(),
  reviewerId: text("reviewer_id").notNull(),
  status: evidenceReviewSessionStatus("status").default("OPEN").notNull(),
  resultingSnapshotId: uuid("resulting_snapshot_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  unique("evidence_review_sessions_run_unique").on(table.extractionRunId),
  unique("evidence_review_sessions_id_business_run_unique").on(
    table.id,
    table.businessId,
    table.extractionRunId,
  ),
  foreignKey({
    columns: [table.extractionRunId, table.businessId],
    foreignColumns: [evidenceExtractionRuns.id, evidenceExtractionRuns.businessId],
    name: "evidence_review_sessions_run_same_business_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.resultingSnapshotId, table.businessId],
    foreignColumns: [businessStateSnapshots.id, businessStateSnapshots.businessId],
    name: "evidence_review_sessions_snapshot_same_business_fk",
  }).onDelete("restrict"),
]);

export const proposalReviews = pgTable("proposal_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  reviewSessionId: uuid("review_session_id").notNull(),
  proposalId: uuid("proposal_id").notNull(),
  extractionRunId: uuid("extraction_run_id").notNull(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "restrict" }),
  decision: evidenceReviewDecision("decision").notNull(),
  reviewedPayload: jsonb("reviewed_payload").$type<Record<string, unknown>>(),
  reason: text("reason"),
  canonicalEntityType: reviewCanonicalEntityType("canonical_entity_type"),
  canonicalEntityId: uuid("canonical_entity_id"),
  canonicalReference: jsonb("canonical_reference").$type<Record<string, unknown>>().default({}).notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("proposal_reviews_proposal_unique").on(table.proposalId),
  index("proposal_reviews_session_idx").on(table.reviewSessionId, table.reviewedAt),
  foreignKey({
    columns: [table.reviewSessionId, table.businessId, table.extractionRunId],
    foreignColumns: [
      evidenceReviewSessions.id,
      evidenceReviewSessions.businessId,
      evidenceReviewSessions.extractionRunId,
    ],
    name: "proposal_reviews_session_same_business_run_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.proposalId, table.businessId, table.extractionRunId],
    foreignColumns: [
      evidenceProposals.id,
      evidenceProposals.businessId,
      evidenceProposals.extractionRunId,
    ],
    name: "proposal_reviews_proposal_same_business_run_fk",
  }).onDelete("restrict"),
  check("proposal_reviews_corrected_payload_check", sql`
    (${table.decision} = 'CORRECTED' and ${table.reviewedPayload} is not null)
    or (${table.decision} <> 'CORRECTED' and ${table.reviewedPayload} is null)
  `),
  check("proposal_reviews_noncanonical_decision_check", sql`
    ${table.decision} not in ('REJECTED', 'UNRESOLVED')
    or (${table.canonicalEntityType} is null and ${table.canonicalEntityId} is null)
  `),
]);

export const strategyWorkflows = pgTable("strategy_workflows", {
  id: uuid("id").defaultRandom().primaryKey(),
  businessId: uuid("business_id").notNull().unique().references(() => businesses.id, { onDelete: "restrict" }),
  state: workflowState("state").default("NEW").notNull(),
  version: integer("version").default(1).notNull(),
  ...timestamps,
});

export const workflowTransitions = pgTable("workflow_transitions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workflowId: uuid("workflow_id").notNull().references(() => strategyWorkflows.id, { onDelete: "restrict" }),
  fromState: workflowState("from_state").notNull(),
  toState: workflowState("to_state").notNull(),
  event: workflowEvent("event").notNull(),
  actorType: actorType("actor_type").notNull(),
  actorId: text("actor_id"),
  reason: text("reason"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("workflow_transitions_workflow_idx").on(table.workflowId, table.createdAt)]);

export const businessRelations = relations(businesses, ({ one, many }) => ({
  profile: one(businessProfiles),
  claims: many(claims),
  evidence: many(evidence),
  metrics: many(metrics),
  snapshots: many(businessStateSnapshots),
  workflow: one(strategyWorkflows),
  evidenceExtractionRuns: many(evidenceExtractionRuns),
  evidenceReviewSessions: many(evidenceReviewSessions),
}));
