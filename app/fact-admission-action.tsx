import type { ReactNode } from "react";

export function FactAdmissionAction({ children }: { children: ReactNode }) {
  return <details className="fact-admission-action">
    <summary>More actions</summary>
    <div className="fact-admission-content">
      <h4>Admit as fact with human confirmation</h4>
      {children}
    </div>
  </details>;
}
