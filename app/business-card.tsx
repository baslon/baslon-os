import Link from "next/link";

export type BusinessCardModel = {
  business: {
    id: string;
    name: string;
    sector: string | null;
    primaryGeography: string | null;
  };
  progress: { statusLabel: string; primaryActionLabel: string };
  primaryHref: string;
  reviewedCount: number;
};

export function BusinessCard({ model }: { model: BusinessCardModel }) {
  const metadata = [model.business.sector, model.business.primaryGeography].filter(Boolean).join(" · ");
  return (
    <article className="business-card">
      <div>
        <h3><Link href={`/businesses/${model.business.id}`}>{model.business.name}</Link></h3>
        {metadata ? <p className="muted business-meta">{metadata}</p> : null}
      </div>
      <div className="business-card-status">
        <p className="status-label">{model.progress.statusLabel}</p>
        <p className="muted">{model.reviewedCount} {model.reviewedCount === 1 ? "item" : "items"} reviewed</p>
      </div>
      <div className="card-actions">
        <Link className="button-link" href={model.primaryHref}>{model.progress.primaryActionLabel}</Link>
        <Link href={`/businesses/${model.business.id}/evidence`}>View Evidence State</Link>
      </div>
    </article>
  );
}
