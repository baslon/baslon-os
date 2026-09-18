import { getDatabase } from "@/db/client";
import { OpenAIEvidenceExtractionModel } from "@/ai/evidence-extractor/openai-adapter";
import { EvidenceExtractionRepository } from "@/repositories/evidence-extraction-repository";
import { EvidenceReviewRepository } from "@/repositories/evidence-review-repository";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { FactAdmissionRepository } from "@/repositories/fact-admission-repository";
import { BusinessService } from "@/services/business-service";
import { BusinessStateService } from "@/services/business-state-service";
import { EvidenceExtractionService } from "@/services/evidence-extraction-service";
import { EvidenceReviewService } from "@/services/evidence-review-service";
import { EvidenceStateService } from "@/services/evidence-state-service";
import { FactAdmissionService } from "@/services/fact-admission-service";
import { createStrategyOrchestrator } from "@/repositories/workflow-repository";
import { BusinessOverviewRepository } from "@/repositories/business-overview-repository";
import { BusinessOverviewService } from "@/services/business-overview-service";
import { BusinessDeletionRepository } from "@/repositories/business-deletion-repository";
import { SourceSubmissionRepository } from "@/repositories/source-submission-repository";
import { SourceSubmissionService } from "@/services/source-submission-service";
import { AddInformationService } from "@/services/add-information-service";
import { OpenAIEvidenceCoherenceModel } from "@/ai/evidence-coherence/openai-adapter";
import { EvidenceCoherenceRepository } from "@/repositories/evidence-coherence-repository";
import { EvidenceCoherenceService } from "@/services/evidence-coherence-service";
import { EvidenceQualityService } from "@/services/evidence-quality-service";
import { AddInformationRepository } from "@/repositories/add-information-repository";
import { InitialIntakeRepository } from "@/repositories/initial-intake-repository";
import { InitialIntakeService } from "@/services/initial-intake-service";
import { GapResolutionService } from "@/services/gap-resolution-service";

export function getInitialIntakeService() {
  return new InitialIntakeService(
    new InitialIntakeRepository(getDatabase()),
    getEvidenceExtractionService(),
  );
}

export function getAddInformationService() {
  return new AddInformationService(
    new AddInformationRepository(getDatabase()),
    getSourceSubmissionService(),
    getEvidenceExtractionService(),
    getEvidenceReviewService(),
  );
}

let repository: FoundationRepository | undefined;

function getFoundationRepository() {
  repository ??= new FoundationRepository(getDatabase());
  return repository;
}

export function getFactAdmissionService() {
  return new FactAdmissionService(new FactAdmissionRepository(getDatabase()));
}

export function getBusinessService() {
  return new BusinessService(
    getFoundationRepository(),
    new BusinessDeletionRepository(getDatabase()),
  );
}

export function getBusinessOverviewService() {
  return new BusinessOverviewService(new BusinessOverviewRepository(getDatabase()));
}

export function getSourceSubmissionService() {
  return new SourceSubmissionService(new SourceSubmissionRepository(getDatabase()));
}

export function getBusinessStateService() {
  return new BusinessStateService(getFoundationRepository());
}

export function getEvidenceExtractionService() {
  return new EvidenceExtractionService(
    new EvidenceExtractionRepository(getDatabase()),
    new OpenAIEvidenceExtractionModel(),
  );
}

export function getEvidenceReviewService() {
  const database = getDatabase();
  return new EvidenceReviewService(
    new EvidenceReviewRepository(database),
    createStrategyOrchestrator(database),
  );
}

export function getEvidenceStateService() {
  return new EvidenceStateService(new EvidenceReviewRepository(getDatabase()));
}

export function getStrategyOrchestrator() {
  return createStrategyOrchestrator(getDatabase());
}

export function getEvidenceCoherenceService() {
  const database = getDatabase();
  return new EvidenceCoherenceService(
    new EvidenceCoherenceRepository(database),
    new OpenAIEvidenceCoherenceModel(),
    createStrategyOrchestrator(database),
  );
}

export function getGapResolutionService() {
  const database = getDatabase();
  return new GapResolutionService(
    new EvidenceCoherenceRepository(database),
    createStrategyOrchestrator(database),
  );
}

export function getEvidenceQualityService() {
  return new EvidenceQualityService(new EvidenceCoherenceRepository(getDatabase()));
}
