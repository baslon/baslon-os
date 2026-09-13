import { getDatabase } from "@/db/client";
import { FoundationRepository } from "@/repositories/foundation-repository";
import { FactAdmissionRepository } from "@/repositories/fact-admission-repository";
import { BusinessService } from "@/services/business-service";
import { BusinessStateService } from "@/services/business-state-service";
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

export function getStrategyOrchestrator() {
  return createStrategyOrchestrator(getDatabase());
}
