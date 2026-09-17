import { relations, sql } from "drizzle-orm";
import {
  check,
  bigint,
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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  analysisFindingReferenceRoles,
  analysisRunStatuses,
  evidenceQualityAreas,
  findingMaterialities,
} from "@/domain/evidence-coherence";

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
export const analysisRunStatus = pgEnum("analysis_run_status", analysisRunStatuses);
export const evidenceQualityArea = pgEnum("evidence_quality_area", evidenceQualityAreas);
export const findingMateriality = pgEnum("finding_materiality", findingMaterialities);
export const analysisFindingReferenceRole = pgEnum(
  "analysis_finding_reference_role",
  analysisFindingReferenceRoles,
);

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

export const sourceSubmissions = pgTable("source_submissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "restrict" }),
  sourceType: text("source_type").notNull(),
  description: text("description"),
  rawText: text("raw_text"),
  sourceReference: text("source_reference"),
  sourceOccurredAt: timestamp("source_occurred_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("source_submissions_id_business_unique").on(table.id, table.businessId),
  index("source_submissions_business_submitted_idx").on(table.businessId, table.submittedAt),
]);

export const sourceSubmissionAttachments = pgTable("source_submission_attachments", {
  id: uuid("id").defaultRandom().primaryKey(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "restrict" }),
  sourceSubmissionId: uuid("source_submission_id").notNull(),
  originalFilename: text("original_filename").notNull(),
  mediaType: text("media_type").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("source_submission_attachments_submission_idx").on(table.sourceSubmissionId, table.createdAt),
  foreignKey({
    columns: [table.sourceSubmissionId, table.businessId],
    foreignColumns: [sourceSubmissions.id, sourceSubmissions.businessId],
    name: "source_submission_attachments_same_business_fk",
  }).onDelete("restrict"),
  check("source_submission_attachments_byte_size_check", sql`${table.byteSize} >= 0`),
]);

export const evidenceExtractionRuns = pgTable("evidence_extraction_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "restrict" }),
  sourceSubmissionId: uuid("source_submission_id"),
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
  index("evidence_extraction_runs_source_submission_idx").on(table.sourceSubmissionId),
  unique("evidence_extraction_runs_id_business_unique").on(table.id, table.businessId),
  foreignKey({
    columns: [table.sourceSubmissionId, table.businessId],
    foreignColumns: [sourceSubmissions.id, sourceSubmissions.businessId],
    name: "evidence_extraction_runs_source_submission_same_business_fk",
  }).onDelete("restrict"),
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
  unique("metrics_id_business_unique").on(table.id, table.businessId),
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

export const analysisRuns = pgTable("analysis_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "restrict" }),
  module: text("module").notNull(),
  runType: text("run_type").notNull(),
  inputSnapshotId: uuid("input_snapshot_id").notNull(),
  inputProjectionVersion: text("input_projection_version").notNull(),
  inputPayload: jsonb("input_payload").$type<Record<string, unknown>>().notNull(),
  inputHash: text("input_hash").notNull(),
  promptVersion: text("prompt_version").notNull(),
  provider: text("provider").notNull(),
  modelIdentifier: text("model_identifier").notNull(),
  modelConfiguration: jsonb("model_configuration").$type<Record<string, unknown>>().default({}).notNull(),
  status: analysisRunStatus("status").default("RUNNING").notNull(),
  rawModelOutput: jsonb("raw_model_output").$type<unknown>(),
  structuredOutput: jsonb("structured_output").$type<Record<string, unknown>>(),
  validationErrors: jsonb("validation_errors").$type<unknown[]>().default([]).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("analysis_runs_id_business_unique").on(table.id, table.businessId),
  index("analysis_runs_business_created_idx").on(table.businessId, table.createdAt),
  index("analysis_runs_snapshot_created_idx").on(table.inputSnapshotId, table.createdAt),
  uniqueIndex("analysis_runs_equivalent_active_unique").on(
    table.businessId,
    table.inputSnapshotId,
    table.module,
    table.inputProjectionVersion,
    table.promptVersion,
  ).where(sql`${table.status} in ('RUNNING', 'SUCCEEDED')`),
  foreignKey({
    columns: [table.inputSnapshotId, table.businessId],
    foreignColumns: [businessStateSnapshots.id, businessStateSnapshots.businessId],
    name: "analysis_runs_snapshot_same_business_fk",
  }).onDelete("restrict"),
  check("analysis_runs_input_payload_object_check", sql`jsonb_typeof(${table.inputPayload}) = 'object'`),
  check("analysis_runs_model_configuration_object_check", sql`jsonb_typeof(${table.modelConfiguration}) = 'object'`),
  check("analysis_runs_validation_errors_array_check", sql`jsonb_typeof(${table.validationErrors}) = 'array'`),
  check("analysis_runs_required_text_check", sql`
    length(btrim(${table.module})) > 0
    and length(btrim(${table.runType})) > 0
    and length(btrim(${table.inputProjectionVersion})) > 0
    and length(btrim(${table.inputHash})) > 0
    and length(btrim(${table.promptVersion})) > 0
    and length(btrim(${table.provider})) > 0
    and length(btrim(${table.modelIdentifier})) > 0
  `),
  check("analysis_runs_completion_check", sql`
    (${table.status} = 'RUNNING' and ${table.completedAt} is null)
    or (${table.status} in ('SUCCEEDED', 'FAILED') and ${table.completedAt} is not null)
  `),
  check("analysis_runs_structured_output_check", sql`
    ${table.status} <> 'SUCCEEDED' or ${table.structuredOutput} is not null
  `),
]);

export const contradictions = pgTable("contradictions", {
  id: uuid("id").defaultRandom().primaryKey(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "restrict" }),
  analysisRunId: uuid("analysis_run_id").notNull(),
  area: evidenceQualityArea("area").notNull(),
  statement: text("statement").notNull(),
  rationale: text("rationale").notNull(),
  materiality: findingMateriality("materiality").notNull(),
  priorityRank: integer("priority_rank").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("contradictions_id_business_unique").on(table.id, table.businessId),
  index("contradictions_run_priority_idx").on(table.analysisRunId, table.priorityRank),
  index("contradictions_business_created_idx").on(table.businessId, table.createdAt),
  foreignKey({
    columns: [table.analysisRunId, table.businessId],
    foreignColumns: [analysisRuns.id, analysisRuns.businessId],
    name: "contradictions_run_same_business_fk",
  }).onDelete("restrict"),
  check("contradictions_priority_rank_check", sql`${table.priorityRank} > 0`),
  check("contradictions_required_text_check", sql`
    length(btrim(${table.statement})) > 0 and length(btrim(${table.rationale})) > 0
  `),
]);

export const evidenceGaps = pgTable("evidence_gaps", {
  id: uuid("id").defaultRandom().primaryKey(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "restrict" }),
  analysisRunId: uuid("analysis_run_id").notNull(),
  area: evidenceQualityArea("area").notNull(),
  missingInformation: text("missing_information").notNull(),
  decisionImpact: text("decision_impact").notNull(),
  materiality: findingMateriality("materiality").notNull(),
  priorityRank: integer("priority_rank").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("evidence_gaps_id_business_unique").on(table.id, table.businessId),
  index("evidence_gaps_run_priority_idx").on(table.analysisRunId, table.priorityRank),
  index("evidence_gaps_business_created_idx").on(table.businessId, table.createdAt),
  foreignKey({
    columns: [table.analysisRunId, table.businessId],
    foreignColumns: [analysisRuns.id, analysisRuns.businessId],
    name: "evidence_gaps_run_same_business_fk",
  }).onDelete("restrict"),
  check("evidence_gaps_priority_rank_check", sql`${table.priorityRank} > 0`),
  check("evidence_gaps_required_text_check", sql`
    length(btrim(${table.missingInformation})) > 0
    and length(btrim(${table.decisionImpact})) > 0
  `),
]);

export const analysisFindingReferences = pgTable("analysis_finding_references", {
  id: uuid("id").defaultRandom().primaryKey(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "restrict" }),
  contradictionId: uuid("contradiction_id"),
  evidenceGapId: uuid("evidence_gap_id"),
  claimId: uuid("claim_id"),
  evidenceId: uuid("evidence_id"),
  metricId: uuid("metric_id"),
  role: analysisFindingReferenceRole("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("analysis_finding_references_business_idx").on(table.businessId),
  index("analysis_finding_references_contradiction_idx").on(table.contradictionId),
  index("analysis_finding_references_gap_idx").on(table.evidenceGapId),
  uniqueIndex("analysis_finding_references_contradiction_claim_unique")
    .on(table.contradictionId, table.claimId)
    .where(sql`${table.contradictionId} is not null and ${table.claimId} is not null`),
  uniqueIndex("analysis_finding_references_contradiction_evidence_unique")
    .on(table.contradictionId, table.evidenceId)
    .where(sql`${table.contradictionId} is not null and ${table.evidenceId} is not null`),
  uniqueIndex("analysis_finding_references_contradiction_metric_unique")
    .on(table.contradictionId, table.metricId)
    .where(sql`${table.contradictionId} is not null and ${table.metricId} is not null`),
  uniqueIndex("analysis_finding_references_gap_claim_unique")
    .on(table.evidenceGapId, table.claimId)
    .where(sql`${table.evidenceGapId} is not null and ${table.claimId} is not null`),
  uniqueIndex("analysis_finding_references_gap_evidence_unique")
    .on(table.evidenceGapId, table.evidenceId)
    .where(sql`${table.evidenceGapId} is not null and ${table.evidenceId} is not null`),
  uniqueIndex("analysis_finding_references_gap_metric_unique")
    .on(table.evidenceGapId, table.metricId)
    .where(sql`${table.evidenceGapId} is not null and ${table.metricId} is not null`),
  foreignKey({
    columns: [table.contradictionId, table.businessId],
    foreignColumns: [contradictions.id, contradictions.businessId],
    name: "analysis_finding_references_contradiction_same_business_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.evidenceGapId, table.businessId],
    foreignColumns: [evidenceGaps.id, evidenceGaps.businessId],
    name: "analysis_finding_references_gap_same_business_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.claimId, table.businessId],
    foreignColumns: [claims.id, claims.businessId],
    name: "analysis_finding_references_claim_same_business_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.evidenceId, table.businessId],
    foreignColumns: [evidence.id, evidence.businessId],
    name: "analysis_finding_references_evidence_same_business_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.metricId, table.businessId],
    foreignColumns: [metrics.id, metrics.businessId],
    name: "analysis_finding_references_metric_same_business_fk",
  }).onDelete("restrict"),
  check("analysis_finding_references_one_finding_check", sql`
    num_nonnulls(${table.contradictionId}, ${table.evidenceGapId}) = 1
  `),
  check("analysis_finding_references_one_canonical_record_check", sql`
    num_nonnulls(${table.claimId}, ${table.evidenceId}, ${table.metricId}) = 1
  `),
]);

export const analysisQuestions = pgTable("analysis_questions", {
  id: uuid("id").defaultRandom().primaryKey(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "restrict" }),
  contradictionId: uuid("contradiction_id"),
  evidenceGapId: uuid("evidence_gap_id"),
  question: text("question").notNull(),
  priorityOrder: integer("priority_order").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("analysis_questions_id_business_unique").on(table.id, table.businessId),
  index("analysis_questions_business_priority_idx").on(table.businessId, table.priorityOrder),
  foreignKey({
    columns: [table.contradictionId, table.businessId],
    foreignColumns: [contradictions.id, contradictions.businessId],
    name: "analysis_questions_contradiction_same_business_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.evidenceGapId, table.businessId],
    foreignColumns: [evidenceGaps.id, evidenceGaps.businessId],
    name: "analysis_questions_gap_same_business_fk",
  }).onDelete("restrict"),
  check("analysis_questions_one_finding_check", sql`
    num_nonnulls(${table.contradictionId}, ${table.evidenceGapId}) = 1
  `),
  check("analysis_questions_priority_order_check", sql`${table.priorityOrder} > 0`),
  check("analysis_questions_required_text_check", sql`length(btrim(${table.question})) > 0`),
]);

export const analysisQuestionSources = pgTable("analysis_question_sources", {
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "restrict" }),
  questionId: uuid("question_id").notNull(),
  sourceSubmissionId: uuid("source_submission_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.questionId, table.sourceSubmissionId] }),
  index("analysis_question_sources_business_idx").on(table.businessId),
  foreignKey({
    columns: [table.questionId, table.businessId],
    foreignColumns: [analysisQuestions.id, analysisQuestions.businessId],
    name: "analysis_question_sources_question_same_business_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.sourceSubmissionId, table.businessId],
    foreignColumns: [sourceSubmissions.id, sourceSubmissions.businessId],
    name: "analysis_question_sources_submission_same_business_fk",
  }).onDelete("restrict"),
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
  sourceSubmissions: many(sourceSubmissions),
  sourceSubmissionAttachments: many(sourceSubmissionAttachments),
}));

export const sourceSubmissionRelations = relations(sourceSubmissions, ({ one, many }) => ({
  business: one(businesses, {
    fields: [sourceSubmissions.businessId],
    references: [businesses.id],
  }),
  attachments: many(sourceSubmissionAttachments),
  extractionRuns: many(evidenceExtractionRuns),
}));

export const sourceSubmissionAttachmentRelations = relations(sourceSubmissionAttachments, ({ one }) => ({
  business: one(businesses, {
    fields: [sourceSubmissionAttachments.businessId],
    references: [businesses.id],
  }),
  sourceSubmission: one(sourceSubmissions, {
    fields: [sourceSubmissionAttachments.sourceSubmissionId],
    references: [sourceSubmissions.id],
  }),
}));

export const evidenceExtractionRunRelations = relations(evidenceExtractionRuns, ({ one }) => ({
  business: one(businesses, {
    fields: [evidenceExtractionRuns.businessId],
    references: [businesses.id],
  }),
  sourceSubmission: one(sourceSubmissions, {
    fields: [evidenceExtractionRuns.sourceSubmissionId],
    references: [sourceSubmissions.id],
  }),
}));
