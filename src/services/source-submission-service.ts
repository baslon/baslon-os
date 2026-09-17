import {
  createQuestionAnswerSubmissionSchema,
  createSourceSubmissionAttachmentSchema,
  createSourceSubmissionSchema,
} from "@/domain/source-submission";
import type { SourceSubmissionRepository } from "@/repositories/source-submission-repository";

export class SourceSubmissionService {
  constructor(private readonly repository: SourceSubmissionRepository) {}

  async create(input: unknown) {
    const parsed = createSourceSubmissionSchema.parse(input);
    await this.repository.assertBusinessActive(parsed.businessId);
    return this.repository.create(parsed);
  }

  async createQuestionAnswer(input: unknown) {
    const parsed = createQuestionAnswerSubmissionSchema.parse(input);
    await this.repository.assertBusinessActive(parsed.businessId);
    return this.repository.createQuestionAnswer(parsed);
  }

  getQuestionContext(businessId: string, questionId: string) {
    return this.repository.getQuestionContext(businessId, questionId);
  }

  getQuestionContextForSource(businessId: string, sourceSubmissionId: string) {
    return this.repository.getQuestionContextForSource(businessId, sourceSubmissionId);
  }

  getById(businessId: string, sourceSubmissionId: string) {
    return this.repository.getById(businessId, sourceSubmissionId);
  }

  listForBusiness(businessId: string) {
    return this.repository.listForBusiness(businessId);
  }

  async addAttachment(input: unknown) {
    const parsed = createSourceSubmissionAttachmentSchema.parse(input);
    await this.repository.assertBusinessActive(parsed.businessId);
    return this.repository.createAttachment(parsed);
  }

  listAttachments(businessId: string, sourceSubmissionId: string) {
    return this.repository.listAttachments(businessId, sourceSubmissionId);
  }

  getForExtractionRun(businessId: string, extractionRunId: string) {
    return this.repository.getForExtractionRun(businessId, extractionRunId);
  }
}
