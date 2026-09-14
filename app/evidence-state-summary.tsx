import { countNoun } from "@/domain/presentation";

export type EvidenceStateSummaryModel = {
  primary: Array<{ singular: string; plural: string; value: number }>;
  claimTypes: Array<{ singular: string; plural: string; value: number }>;
};

export function EvidenceStateSummary({ summary }: { summary: EvidenceStateSummaryModel }) {
  return <section className="evidence-summary" aria-label="Evidence State summary">
    <div className="summary-grid primary-summary">{summary.primary.map((item) => <article className="summary-card" key={item.plural}><strong>{item.value}</strong><span>{countNoun(item.value, item.singular, item.plural)}</span></article>)}</div>
    <div className="claim-type-breakdown">
      <p className="eyebrow">Claim types</p>
      <div>{summary.claimTypes.map((item) => <span key={item.plural}><strong>{item.value}</strong> {countNoun(item.value, item.singular, item.plural)}</span>)}</div>
    </div>
  </section>;
}
