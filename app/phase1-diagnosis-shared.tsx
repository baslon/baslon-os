import { diagnosisLabelDefinitions } from "@/domain/phase1-diagnosis";
import {
  diagnosisReviewFields,
  type DiagnosisReviewField,
} from "@/domain/phase1-diagnosis-review-card";
import type { DiagnosisDisplayItem, DiagnosisViewModel } from "@/services/phase1-diagnosis-service";

export const label = (value: string) => value.replaceAll("_", " ");

/** Renders one material field exactly as given: the generated item or the effective reviewed item. */
export function FieldValue({ item, field }: { item: DiagnosisDisplayItem; field: DiagnosisReviewField["field"] }) {
  if (field === "headline") {
    return item.headline ? <>{item.headline}</> : <span className="muted">Not given</span>;
  }
  if (field === "references") {
    return item.references.length
      ? <ul className="reference-list">{item.references.map((reference) => <li key={`${reference.handle}-${reference.role}`}>
        <code>{reference.handle}</code> · {label(reference.role)} · {reference.entityType}: {reference.label}
      </li>)}</ul>
      : <span className="muted">No references</span>;
  }
  if (field === "grounding") {
    return <>{label(item.grounding)} <span className="muted">({diagnosisLabelDefinitions.grounding[item.grounding as keyof typeof diagnosisLabelDefinitions.grounding]})</span></>;
  }
  if (field === "materiality") {
    return <>{item.materiality} <span className="muted">({diagnosisLabelDefinitions.materiality})</span></>;
  }
  if (field === "interpretationConfidence") {
    return item.interpretationConfidence
      ? <>{item.interpretationConfidence} <span className="muted">({diagnosisLabelDefinitions.interpretationConfidence})</span></>
      : <span className="muted">Not given</span>;
  }
  if (field === "limitations") return item.limitations ? <>{item.limitations}</> : <span className="muted">None stated</span>;
  if (field === "itemType") return <>{label(item.itemType)}</>;
  return <>{item[field]}</>;
}

/**
 * Every material field of the item's own contract, exactly as recorded (review
 * and audit surfaces). The manifest is the run's: 8 fields for v1, 9 for v2.
 */
export function Fields({ item, fields = diagnosisReviewFields }: { item: DiagnosisDisplayItem; fields?: readonly DiagnosisReviewField[] }) {
  return <dl className="review-record-details">
    {fields.map(({ field, label: fieldLabel }) => <div key={field} data-field={field}>
      <dt>{fieldLabel}</dt><dd><FieldValue item={item} field={field} /></dd>
    </div>)}
  </dl>;
}

/** The recorded provenance of the displayed diagnosis run. */
export function provenanceRows(model: DiagnosisViewModel): Array<[string, string]> {
  const run = model.run!;
  return [
    ["Diagnosis run", run.id],
    ["Snapshot", model.snapshot ? `${model.snapshot.id} (version ${model.snapshot.version})` : "none"],
    ["Snapshot content hash", run.snapshotContentHash ?? "unrecorded"],
    ["Input version", run.inputProjectionVersion],
    ["Prompt version", run.promptVersion],
    ["Input hash", run.inputHash],
    ["Provider / model", `${run.provider} / ${run.modelIdentifier}`],
    ["Started", run.createdAt],
    ["Completed", run.completedAt ?? "not completed"],
  ];
}

/**
 * A stored UTC timestamp shown for people, in UK time (the product's launch
 * market). The stored value is unchanged and kept in the element's dateTime.
 */
export function formatApprovalTime(iso: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short",
  }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${parts.timeZoneName}`;
}

export function ApprovalTime({ iso }: { iso: string }) {
  return <time dateTime={iso}>{formatApprovalTime(iso)}</time>;
}
