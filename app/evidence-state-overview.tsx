import Link from "next/link";

export function EvidenceStateOverview({
  claims,
  activeClaimTypes,
  evidence,
  metrics,
  relationships,
}: {
  claims: number;
  activeClaimTypes: number;
  evidence: number;
  metrics: number;
  relationships: number;
}) {
  return <div className="overview-grid">
    <section className="panel"><h2>Claims</h2><p>{claims} reviewed claims across {activeClaimTypes} claim types.</p><Link href="?view=claims">View Claims →</Link></section>
    <section className="panel"><h2>Evidence</h2><p>{evidence} traceable evidence records.</p><Link href="?view=evidence">View Evidence →</Link></section>
    <section className="panel"><h2>Metrics</h2><p>{metrics} structured business metrics.</p><Link href="?view=metrics">View Metrics →</Link></section>
    <section className="panel"><h2>Relationships</h2><p>{relationships > 0 ? `${relationships} reviewed links between claims and evidence.` : "No reviewed relationships yet."}</p><Link href="?view=relationships">View Relationships →</Link></section>
  </div>;
}
