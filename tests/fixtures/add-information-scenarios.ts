import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import * as s from "@/db/schema";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { SourceSubmissionRepository } from "@/repositories/source-submission-repository";
import { EvidenceExtractionRepository } from "@/repositories/evidence-extraction-repository";
import { EvidenceReviewRepository } from "@/repositories/evidence-review-repository";
import { createStrategyOrchestrator } from "@/repositories/workflow-repository";
import { BusinessService } from "@/services/business-service";
import { SourceSubmissionService } from "@/services/source-submission-service";
import { EvidenceExtractionService } from "@/services/evidence-extraction-service";
import { EvidenceReviewService } from "@/services/evidence-review-service";
import { AddInformationService } from "@/services/add-information-service";
import { AddInformationRepository } from "@/repositories/add-information-repository";
import { baslonBusiness, baslonMessyIntake, baslonExtractionOutput } from "./baslon-business";
import type { EvidenceExtractionModelInput } from "@/ai/evidence-extractor/contracts";
import type { EvidenceExtractionOutput } from "@/ai/evidence-extractor/contracts";

export function addInformationScenarios(getDatabase: () => Database) {
  async function setup() {
    const db = getDatabase();
    const foundation = new FoundationRepository(db);
    const business = await new BusinessService(foundation).create({ ...baslonBusiness, name: `Continuous evidence ${randomUUID()}` });
    const sources = new SourceSubmissionService(new SourceSubmissionRepository(db));
    const runs = new EvidenceExtractionRepository(db);
    const orchestrator = createStrategyOrchestrator(db);
    const repository = new EvidenceReviewRepository(db);
    const reviews = new EvidenceReviewService(repository, orchestrator);
    let malformed = false;
    let modelOutput: EvidenceExtractionOutput = structuredClone(baslonExtractionOutput);
    const modelInputs: EvidenceExtractionModelInput[] = [];
    const extraction = new EvidenceExtractionService(runs, {
      getConfiguration: () => ({ provider: "test", model: "deterministic", metadata: {} }),
      extract: async (input) => {
        modelInputs.push(input);
        return { output: malformed ? {} : structuredClone(modelOutput), rawOutput: {} };
      },
    });
    const addInformationRepository = new AddInformationRepository(db);
    const service = new AddInformationService(
      addInformationRepository,
      sources,
      extraction,
      reviews,
    );
    async function complete(runId: string) {
      const session = await reviews.startReview({ businessId: business.id, extractionRunId: runId, reviewerId: "test-human" });
      const details = await reviews.getReview(session.id, business.id);
      for (const proposal of details.proposals) {
        await reviews.reviewProposal({ businessId: business.id, reviewSessionId: session.id,
          reviewerId: "test-human", proposalId: proposal.id,
          decision: proposal.proposalRef === "claim_3" ? "UNRESOLVED" : "ACCEPTED" });
      }
      return reviews.completeReview({ businessId: business.id, reviewSessionId: session.id, reviewerId: "test-human" });
    }
    for (const [event, actorType] of [["START_INTAKE", "human"], ["SUBMIT_INTAKE", "human"], ["PROCESS_EVIDENCE", "system"]] as const) {
      await orchestrator.transition({ businessId: business.id, event, actorType });
    }
    const original = await extraction.extract({ businessId: business.id, rawIntakeText: baslonMessyIntake });
    const first = await complete(original.run.id);
    return { db, business, foundation, sources, runs, reviews, repository, service, complete, first,
      extraction, addInformationRepository,
      orchestrator, modelInputs,
      fail: (value: boolean) => { malformed = value; },
      output: (value: EvidenceExtractionOutput) => { modelOutput = value; } };
  }

  async function addQuestion(c: Awaited<ReturnType<typeof setup>>, questionText: string) {
    const [run] = await c.db.insert(s.analysisRuns).values({
      businessId: c.business.id,
      inputSnapshotId: c.first.snapshot.id,
      module: "evidence_coherence",
      runType: "snapshot_analysis",
      inputProjectionVersion: "evidence_coherence_input_v1",
      inputPayload: {}, inputHash: randomUUID(), promptVersion: "evidence_coherence_v1",
      provider: "test", modelIdentifier: "deterministic", modelConfiguration: {},
    }).returning();
    await c.db.update(s.analysisRuns).set({
      status: "SUCCEEDED", structuredOutput: {}, validationErrors: [], completedAt: new Date(),
    }).where(eq(s.analysisRuns.id, run.id));
    const [gap] = await c.db.insert(s.evidenceGaps).values({
      businessId: c.business.id, analysisRunId: run.id,
      area: "customers_and_market", missingInformation: "Current client count is unknown.",
      decisionImpact: "Capacity cannot be assessed.", materiality: "high", priorityRank: 1,
    }).returning();
    const [question] = await c.db.insert(s.analysisQuestions).values({
      businessId: c.business.id, evidenceGapId: gap.id,
      question: questionText, priorityOrder: 1,
    }).returning();
    await c.orchestrator.transition({ businessId: c.business.id, event: "RUN_GAP_ANALYSIS", actorType: "system" });
    await c.orchestrator.transition({ businessId: c.business.id, event: "MARK_ANALYSIS_COMPLETE", actorType: "system" });
    return { run, gap, question };
  }

  async function canonical(db: Database, businessId: string) {
    return {
      claims: await db.select().from(s.claims).where(eq(s.claims.businessId, businessId)).orderBy(s.claims.id),
      evidence: await db.select().from(s.evidence).where(eq(s.evidence.businessId, businessId)).orderBy(s.evidence.id),
      metrics: await db.select().from(s.metrics).where(eq(s.metrics.businessId, businessId)).orderBy(s.metrics.id),
      links: await db.select().from(s.claimEvidence).where(eq(s.claimEvidence.businessId, businessId)).orderBy(s.claimEvidence.claimId),
      snapshots: await db.select().from(s.businessStateSnapshots).where(eq(s.businessStateSnapshots.businessId, businessId)).orderBy(s.businessStateSnapshots.version),
    };
  }

  async function commandState(c: Awaited<ReturnType<typeof setup>>) {
    const workflow = await c.foundation.getWorkflow(c.business.id);
    return {
      sources: await c.sources.listForBusiness(c.business.id),
      runs: await c.db.select().from(s.evidenceExtractionRuns)
        .where(eq(s.evidenceExtractionRuns.businessId, c.business.id))
        .orderBy(s.evidenceExtractionRuns.createdAt, s.evidenceExtractionRuns.id),
      questionLinks: await c.db.select().from(s.analysisQuestionSources)
        .where(eq(s.analysisQuestionSources.businessId, c.business.id)),
      workflow,
      transitions: await c.foundation.getTransitionHistory(workflow!.id),
    };
  }

  function triggerName(prefix: string) {
    return `${prefix}_${randomUUID().replaceAll("-", "")}`;
  }

  async function installFailureTrigger(
    db: Database,
    table: string,
    timing: "INSERT" | "UPDATE",
    predicate: string,
  ) {
    const name = triggerName(`test_add_info_${timing.toLowerCase()}`);
    await db.execute(sql.raw(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RAISE EXCEPTION 'forced Add Information command failure'; END IF; RETURN NEW; END $$`));
    await db.execute(sql.raw(`CREATE TRIGGER ${name} BEFORE ${timing} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${name}()`));
    return async () => {
      await db.execute(sql.raw(`DROP TRIGGER ${name} ON ${table}`));
      await db.execute(sql.raw(`DROP FUNCTION ${name}()`));
    };
  }

  it("preserves cumulative state through two additions, explicit reviews and three immutable snapshots", async () => {
    const c = await setup();
    const other = await setup();
    const otherBefore = await canonical(c.db, other.business.id);
    for (const version of [2, 3]) {
      const before = await canonical(c.db, c.business.id);
      const result = await c.service.submit({ businessId: c.business.id, rawText: baslonMessyIntake, sourceReference: `Addition ${version}` });
      expect(await canonical(c.db, c.business.id)).toEqual(before);
      expect(result.run.sourceSubmissionId).toBeTruthy();
      expect(result.proposals.every(p => p.businessId === c.business.id && p.extractionRunId === result.run.id)).toBe(true);
      await c.reviews.completeReview({ businessId: c.business.id, reviewSessionId: c.first.session.id, reviewerId: "test-human" });
      expect((await c.foundation.getWorkflow(c.business.id))?.state).toBe("EVIDENCE_PROCESSING");
      await expect(c.service.submit({ businessId: c.business.id, rawText: baslonMessyIntake })).rejects.toThrow("Complete");
      const completed = await c.complete(result.run.id);
      expect(completed.snapshot.version).toBe(version);
      const after = await canonical(c.db, c.business.id);
      expect(after.claims).toEqual(expect.arrayContaining(before.claims));
      expect(after.evidence).toEqual(expect.arrayContaining(before.evidence));
      expect(after.metrics).toEqual(expect.arrayContaining(before.metrics));
      expect(after.links).toEqual(expect.arrayContaining(before.links));
      expect(after.snapshots.slice(0, -1)).toEqual(before.snapshots);
      const payload = completed.snapshot.snapshotData as { evidence: { id: string }[]; claims: { id: string }[]; metrics: { id: string }[] };
      expect(payload.evidence.map(e => e.id).sort()).toEqual(after.evidence.map(e => e.id).sort());
      expect(payload.claims.map(e => e.id).sort()).toEqual(after.claims.map(e => e.id).sort());
      expect(payload.metrics.map(e => e.id).sort()).toEqual(after.metrics.map(e => e.id).sort());
      await c.reviews.completeReview({ businessId: c.business.id, reviewSessionId: completed.session.id, reviewerId: "test-human" });
      expect(await canonical(c.db, c.business.id)).toEqual(after);
      await expect(c.reviews.completeReview({ businessId: other.business.id, reviewSessionId: completed.session.id, reviewerId: "test-human" })).rejects.toThrow();
    }
    const sources = await c.sources.listForBusiness(c.business.id);
    expect(sources).toHaveLength(2);
    expect(new Set(sources.map(x => x.id)).size).toBe(2);
    expect(sources.every(x => x.rawText === baslonMessyIntake)).toBe(true);
    expect(await canonical(c.db, other.business.id)).toEqual(otherBefore);
  });

  it("rejects empty input and retains the same immutable source across a failed run and retry", async () => {
    const c = await setup();
    await expect(c.service.submit({ businessId: c.business.id, rawText: "   " })).rejects.toThrow();
    expect(await c.sources.listForBusiness(c.business.id)).toEqual([]);
    const before = await canonical(c.db, c.business.id);
    c.fail(true);
    await expect(c.service.submit({ businessId: c.business.id, rawText: baslonMessyIntake })).rejects.toThrow();
    const failed = (await c.runs.getLatestRun(c.business.id))!;
    const sources = await c.sources.listForBusiness(c.business.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.validationErrors.length).toBeGreaterThan(0);
    expect(await c.runs.getProposals(failed.id, c.business.id)).toEqual([]);
    expect(await canonical(c.db, c.business.id)).toEqual(before);
    const other = await setup();
    await expect(c.service.retry({ businessId: other.business.id, runId: failed.id })).rejects.toThrow();
    c.fail(false);
    const retried = await c.service.retry({ businessId: c.business.id, runId: failed.id });
    expect(retried.run.id).not.toBe(failed.id);
    expect(retried.run.sourceSubmissionId).toBe(failed.sourceSubmissionId);
    expect(await c.sources.listForBusiness(c.business.id)).toEqual(sources);
    expect(await c.runs.getRun(failed.id, c.business.id)).toEqual(failed);
    expect(await canonical(c.db, c.business.id)).toEqual(before);
    await expect(c.service.retry({ businessId: c.business.id, runId: failed.id })).rejects.toThrow();
  });

  it("recovers an abandoned Add Information run without duplicating its source or transition", async () => {
    vi.stubEnv("AI_RUN_STALE_AFTER_MS", "1");
    try {
      const c = await setup();
      c.output({ claims: [], evidence: [], metrics: [], relationships: [] });
      const prepared = c.extraction.prepare({
        businessId: c.business.id,
        rawIntakeText: "The business has 12 active clients.",
        sourceType: "additional_text",
        sourceMetadata: { suppliedBy: "human_ui" },
      });
      const abandoned = await c.addInformationRepository.prepare({
        businessId: c.business.id,
        rawText: "The business has 12 active clients.",
        runStart: prepared.runStart,
      });
      const before = await commandState(c);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const retry = await c.service.retry({
        businessId: c.business.id,
        runId: abandoned.run.id,
      });
      const after = await commandState(c);
      expect(retry.run.id).not.toBe(abandoned.run.id);
      expect(retry.run.sourceSubmissionId).toBe(abandoned.source.id);
      expect(after.sources).toEqual(before.sources);
      expect(after.runs).toHaveLength(before.runs.length + 1);
      expect(after.transitions.filter((item) => item.event === "ADD_EVIDENCE"))
        .toHaveLength(before.transitions.filter((item) => item.event === "ADD_EVIDENCE").length);
      expect(await c.runs.getRun(abandoned.run.id, c.business.id)).toMatchObject({
        status: "FAILED",
        validationErrors: expect.arrayContaining([
          expect.objectContaining({ code: "stale_run_recovered" }),
        ]),
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("accepts ordinary Add Information from GAP_RESOLUTION_REQUIRED without creating a question link", async () => {
    const c = await setup();
    await addQuestion(c, "What is the current retention rate?");
    const result = await c.service.submit({
      businessId: c.business.id,
      rawText: baslonMessyIntake,
      sourceReference: "Voluntary update",
    });
    expect(result.run.sourceSubmissionId).toBeTruthy();
    expect((await c.foundation.getWorkflow(c.business.id))?.state).toBe("EVIDENCE_PROCESSING");
    expect(await c.db.select().from(s.analysisQuestionSources).where(and(
      eq(s.analysisQuestionSources.businessId, c.business.id),
      eq(s.analysisQuestionSources.sourceSubmissionId, result.run.sourceSubmissionId!),
    ))).toEqual([]);
  });

  it("rolls back source, workflow and run when workflow persistence fails", async () => {
    const c = await setup();
    const before = await commandState(c);
    const modelCalls = c.modelInputs.length;
    const remove = await installFailureTrigger(
      c.db,
      "strategy_workflows",
      "UPDATE",
      `OLD.id = '${before.workflow!.id}'::uuid`,
    );
    try {
      await expect(c.service.submit({
        businessId: c.business.id,
        rawText: baslonMessyIntake,
      })).rejects.toThrow();
      expect(await commandState(c)).toEqual(before);
      expect(c.modelInputs).toHaveLength(modelCalls);
    } finally {
      await remove();
    }
  });

  it("rolls back source and workflow transition when extraction-run creation fails", async () => {
    const c = await setup();
    const before = await commandState(c);
    const modelCalls = c.modelInputs.length;
    const remove = await installFailureTrigger(
      c.db,
      "evidence_extraction_runs",
      "INSERT",
      `NEW.business_id = '${c.business.id}'::uuid`,
    );
    try {
      await expect(c.service.submit({
        businessId: c.business.id,
        rawText: baslonMessyIntake,
      })).rejects.toThrow();
      expect(await commandState(c)).toEqual(before);
      expect(c.modelInputs).toHaveLength(modelCalls);
    } finally {
      await remove();
    }
  });

  it("rolls back a question answer when question-link creation fails", async () => {
    const c = await setup();
    const { question } = await addQuestion(c, "What is current delivery capacity?");
    const before = await commandState(c);
    const modelCalls = c.modelInputs.length;
    const remove = await installFailureTrigger(
      c.db,
      "analysis_question_sources",
      "INSERT",
      `NEW.question_id = '${question.id}'::uuid`,
    );
    try {
      await expect(c.service.submit({
        businessId: c.business.id,
        questionId: question.id,
        rawText: "20 hours per week",
      })).rejects.toThrow();
      expect(await commandState(c)).toEqual(before);
      expect(c.modelInputs).toHaveLength(modelCalls);
      expect(await c.sources.getQuestionContext(c.business.id, question.id))
        .toMatchObject({ questionId: question.id, sourceSubmissionId: undefined });
    } finally {
      await remove();
    }
  });

  it("rolls back canonical application if the audit fails during an additional review", async () => {
    const c = await setup();
    const result = await c.service.submit({ businessId: c.business.id, rawText: baslonMessyIntake });
    const session = await c.reviews.startReview({ businessId: c.business.id, extractionRunId: result.run.id, reviewerId: "test-human" });
    const before = await canonical(c.db, c.business.id);
    await expect(c.repository.applyDecision({ businessId: c.business.id, reviewSessionId: session.id,
      proposalId: result.proposals[0].id, reviewerId: "test-human", decision: "REJECTED", reviewedPayload: null,
      canonical: { type: "claim", values: { businessId: c.business.id, statement: "Must roll back", claimType: "hypothesis", subjectArea: "test", confidenceLevel: "low", sourceType: "test" } },
    })).rejects.toThrow();
    expect(await canonical(c.db, c.business.id)).toEqual(before);
    const details = await c.reviews.getReview(session.id, c.business.id);
    expect(details.reviews).toEqual([]);
    await expect(c.reviews.completeReview({ businessId: c.business.id, reviewSessionId: session.id, reviewerId: "test-human" })).rejects.toThrow("Every proposal");
    // Historical snapshots remain protected independently of the application service.
    await expect(c.db.execute(sql`update business_state_snapshots set version = 99 where id = ${c.first.snapshot.id}`)).rejects.toThrow();
  });

  it("rolls back the new snapshot when review completion fails, preserving earlier human decisions", async () => {
    const c = await setup();
    const result = await c.service.submit({ businessId: c.business.id, rawText: baslonMessyIntake });
    const session = await c.reviews.startReview({ businessId: c.business.id, extractionRunId: result.run.id, reviewerId: "test-human" });
    for (const proposal of result.proposals) {
      await c.reviews.reviewProposal({ businessId: c.business.id, reviewSessionId: session.id,
        proposalId: proposal.id, reviewerId: "test-human", decision: "ACCEPTED" });
    }
    const before = await canonical(c.db, c.business.id);
    const trigger = `test_completion_${randomUUID().replaceAll("-", "")}`;
    // The trigger is restricted to this test's session and always removed.
    await c.db.execute(sql.raw(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id = '${session.id}'::uuid THEN RAISE EXCEPTION 'forced completion failure'; END IF; RETURN NEW; END $$`));
    await c.db.execute(sql.raw(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON evidence_review_sessions FOR EACH ROW EXECUTE FUNCTION ${trigger}()`));
    try {
      await expect(c.reviews.completeReview({ businessId: c.business.id, reviewSessionId: session.id, reviewerId: "test-human" })).rejects.toThrow();
      expect(await canonical(c.db, c.business.id)).toEqual(before);
      expect((await c.reviews.getReview(session.id, c.business.id)).session.status).toBe("OPEN");
      expect((await c.foundation.getWorkflow(c.business.id))?.state).toBe("EVIDENCE_PROCESSING");
    } finally {
      await c.db.execute(sql.raw(`DROP TRIGGER ${trigger} ON evidence_review_sessions`));
      await c.db.execute(sql.raw(`DROP FUNCTION ${trigger}()`));
    }
    const completed = await c.reviews.completeReview({ businessId: c.business.id, reviewSessionId: session.id, reviewerId: "test-human" });
    expect(completed.snapshot.version).toBe(2);
  });

  it("submits a question answer as the only evidence source and preserves its context through review", async () => {
    const c = await setup();
    const { question, gap } = await addQuestion(c, "How many active clients does the business currently serve?");
    const [otherQuestion] = await c.db.insert(s.analysisQuestions).values({
      businessId: c.business.id, evidenceGapId: gap.id,
      question: "How many clients were active last quarter?", priorityOrder: 2,
    }).returning();
    c.output({
      claims: [{
        proposalRef: "claim_1", statement: "The active client count is stable.",
        claimType: "management_belief", subjectArea: "customers",
        confidenceLevel: "low", confidenceScore: 0.4,
        confidenceBasis: { basis: "Short management answer" }, sourceType: "additional_text",
      }],
      evidence: [{
        proposalRef: "evidence_1", evidenceType: "management_record",
        statement: "The business currently serves 25 active clients.", valueNumeric: 25,
        valueText: "25 active clients", unit: "clients", periodStart: null, periodEnd: null,
        sourceType: "additional_text", sourceReference: null,
        sourceMetadata: { suppliedBy: "business-user", notes: null },
        reliabilityLevel: "medium", reliabilityScore: 0.7, directnessLevel: "direct",
        recencyLevel: "current", rawPayload: { excerpt: "25 active clients" },
        materiality: "high", sourceExcerpt: "25 active clients",
      }],
      metrics: [], relationships: [],
    });
    const before = await canonical(c.db, c.business.id);
    const result = await c.service.submit({
      businessId: c.business.id, questionId: question.id, rawText: "25 active clients",
    });
    expect(result.run.promptVersion).toBe("evidence_extractor_v5");
    expect(result.run.sourceMetadata).toEqual({
      suppliedBy: "human_ui",
      interpretiveContext: {
        kind: "analysis_question", questionId: question.id,
        questionText: "How many active clients does the business currently serve?",
      },
    });
    expect(c.modelInputs.at(-1)?.rawIntakeText).toBe("25 active clients");
    expect(c.modelInputs.at(-1)?.interpretiveContext).toEqual({
      kind: "analysis_question", questionId: question.id,
      questionText: "How many active clients does the business currently serve?",
    });
    expect(await canonical(c.db, c.business.id)).toEqual(before);
    const source = await c.sources.getById(c.business.id, result.run.sourceSubmissionId!);
    expect(source?.rawText).toBe("25 active clients");
    expect(source?.rawText).not.toContain(question.question);
    const links = await c.db.select().from(s.analysisQuestionSources).where(eq(s.analysisQuestionSources.questionId, question.id));
    expect(links).toEqual([expect.objectContaining({
      businessId: c.business.id, questionId: question.id,
      sourceSubmissionId: result.run.sourceSubmissionId,
    })]);
    await expect(c.sources.createQuestionAnswer({
      businessId: c.business.id, questionId: question.id,
      rawText: "26 active clients", sourceType: "additional_text",
    })).rejects.toThrow("already has submitted information");
    await expect(c.service.submit({
      businessId: c.business.id, questionId: question.id, rawText: "26 active clients",
    })).rejects.toThrow();
    const session = await c.reviews.startReview({
      businessId: c.business.id, extractionRunId: result.run.id, reviewerId: "test-human",
    });
    const details = await c.reviews.getReview(session.id, c.business.id);
    for (const proposal of details.proposals) {
      await c.reviews.reviewProposal({
        businessId: c.business.id, reviewSessionId: session.id,
        proposalId: proposal.id, reviewerId: "test-human",
        decision: proposal.proposalRef === "evidence_1" ? "ACCEPTED" : "REJECTED",
      });
    }
    const completed = await c.reviews.completeReview({
      businessId: c.business.id, reviewSessionId: session.id, reviewerId: "test-human",
    });
    expect(completed.snapshot.version).toBe(2);
    const after = await canonical(c.db, c.business.id);
    expect(after.evidence).toEqual(expect.arrayContaining(before.evidence));
    expect(after.evidence.some((item) => item.statement === "The business currently serves 25 active clients.")).toBe(true);
    expect(after.claims.some((item) => item.statement === "The active client count is stable.")).toBe(false);
    expect(after.snapshots[0]).toEqual(before.snapshots[0]);
    await expect(c.sources.createQuestionAnswer({
      businessId: c.business.id, questionId: otherQuestion.id,
      rawText: "24 clients", sourceType: "additional_text",
    })).rejects.toThrow("historical snapshot");
  });

  it("rejects cross-business question IDs and retries failed contextual extraction against the same answer", async () => {
    const c = await setup();
    const other = await setup();
    const { question } = await addQuestion(c, "What is the current conversion rate?");
    await addQuestion(other, "What is the current retention rate?");
    await expect(other.service.submit({
      businessId: other.business.id, questionId: question.id, rawText: "20%",
    })).rejects.toThrow("question not found");
    c.fail(true);
    await expect(c.service.submit({
      businessId: c.business.id, questionId: question.id, rawText: "20%",
    })).rejects.toThrow();
    const failed = (await c.runs.getLatestRun(c.business.id))!;
    const sourcesBefore = await c.sources.listForBusiness(c.business.id);
    const commandBeforeRetry = await commandState(c);
    expect(failed.promptVersion).toBe("evidence_extractor_v5");
    c.fail(false);
    c.output({ claims: [], evidence: [], metrics: [], relationships: [] });
    const retried = await c.service.retry({ businessId: c.business.id, runId: failed.id });
    expect(retried.run.sourceSubmissionId).toBe(failed.sourceSubmissionId);
    expect(retried.run.promptVersion).toBe("evidence_extractor_v5");
    expect(await c.sources.listForBusiness(c.business.id)).toEqual(sourcesBefore);
    const commandAfterRetry = await commandState(c);
    expect(commandAfterRetry.questionLinks).toEqual(commandBeforeRetry.questionLinks);
    expect(commandAfterRetry.transitions.filter((item) => item.event === "ADD_EVIDENCE"))
      .toEqual(commandBeforeRetry.transitions.filter((item) => item.event === "ADD_EVIDENCE"));
    expect(c.modelInputs.at(-1)?.interpretiveContext?.questionId).toBe(question.id);
  });

  it("keeps historical questions readable but prevents an archived Business from answering", async () => {
    const c = await setup();
    const { question } = await addQuestion(c, "What is current delivery capacity?");
    await new BusinessService(c.foundation).archive(c.business.id);
    expect((await c.sources.getQuestionContext(c.business.id, question.id))?.questionText)
      .toBe("What is current delivery capacity?");
    await expect(c.service.submit({
      businessId: c.business.id, questionId: question.id, rawText: "20 hours per week",
    })).rejects.toThrow("archived");
  });
}
