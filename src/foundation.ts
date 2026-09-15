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

export function getAddInformationService() {
  return new AddInformationService(getSourceSubmissionService(), getEvidenceExtractionService(), getEvidenceReviewService(), getStrategyOrchestrator());
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
