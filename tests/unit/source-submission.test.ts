import { describe, expect, it } from "vitest";
import {
  createSourceSubmissionAttachmentSchema,
  createSourceSubmissionSchema,
} from "@/domain/source-submission";

const businessId = "7f3a9100-0000-4000-8000-000000000001";
const sourceSubmissionId = "7f3a9100-0000-4000-8000-000000000002";

describe("Source Submission validation", () => {
  it("accepts text and file-only source foundations without inventing content", () => {
    expect(createSourceSubmissionSchema.parse({
      businessId,
      sourceType: "additional_text",
      description: "Sales meeting — September 2026",
      rawText: "The sales team reviewed the current pipeline.",
      sourceOccurredAt: "2026-09-10T09:00:00.000Z",
    })).toMatchObject({
      businessId,
      sourceType: "additional_text",
      sourceOccurredAt: new Date("2026-09-10T09:00:00.000Z"),
    });
    expect(createSourceSubmissionSchema.parse({
      businessId,
      sourceType: "file_upload",
      rawText: null,
    }).rawText).toBeNull();
  });

  it("validates attachment metadata without accepting invalid byte sizes", () => {
    expect(createSourceSubmissionAttachmentSchema.parse({
      businessId,
      sourceSubmissionId,
      originalFilename: "Management Accounts.pdf",
      mediaType: "application/pdf",
      byteSize: 2048,
    })).toMatchObject({ sourceSubmissionId, byteSize: 2048 });
    expect(() => createSourceSubmissionAttachmentSchema.parse({
      businessId,
      sourceSubmissionId,
      originalFilename: "Management Accounts.pdf",
      mediaType: "application/pdf",
      byteSize: -1,
    })).toThrow();
  });
});
