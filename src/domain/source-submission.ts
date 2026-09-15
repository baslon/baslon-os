import { z } from "zod";

const optionalText = z.string().trim().min(1).nullable().optional();

export const createSourceSubmissionSchema = z.object({
  businessId: z.uuid(),
  sourceType: z.string().trim().min(1),
  description: optionalText,
  rawText: optionalText,
  sourceReference: optionalText,
  sourceOccurredAt: z.coerce.date().nullable().optional(),
}).strict();

export const createSourceSubmissionAttachmentSchema = z.object({
  businessId: z.uuid(),
  sourceSubmissionId: z.uuid(),
  originalFilename: z.string().trim().min(1),
  mediaType: z.string().trim().min(1),
  byteSize: z.number().int().nonnegative().safe(),
}).strict();

export type CreateSourceSubmission = z.output<typeof createSourceSubmissionSchema>;
export type CreateSourceSubmissionAttachment = z.output<typeof createSourceSubmissionAttachmentSchema>;

export class SourceSubmissionOwnershipError extends Error {
  constructor() {
    super("Source submission does not belong to this business.");
    this.name = "SourceSubmissionOwnershipError";
  }
}
