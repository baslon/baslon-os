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

let repository: FoundationRepository | undefined;

function getFoundationRepository() {
  repository ??= new FoundationRepository(getDatabase());
  return repository;
}

export function getFactAdmissionService() {
  return new FactAdmissionService(new FactAdmissionRepository(getDatabase()));
}

export function getBusinessService() {
  return new BusinessService(getFoundationRepository());
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
