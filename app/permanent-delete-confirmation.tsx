"use client";

import Link from "next/link";
import { useState } from "react";
import { permanentlyDeleteBusinessAction } from "./actions";

export function PermanentDeleteConfirmation({
  businessId,
  businessName,
  phrase,
  duplicateName,
  website,
  geography,
  error,
}: {
  businessId: string;
  businessName: string;
  phrase: string;
  duplicateName: boolean;
  website: string | null;
  geography: string | null;
  error?: string;
}) {
  const [confirmation, setConfirmation] = useState("");
  const matches = confirmation.trim() === phrase;
  return <main className="narrow">
    <nav className="breadcrumbs"><Link href="/businesses">Businesses</Link> <span aria-hidden="true">/</span> <Link href="/businesses/archived">Archived</Link> <span aria-hidden="true">/</span> Permanent delete</nav>
    <p className="eyebrow danger-text">Danger zone</p>
    <h1 className="task-title">Permanently delete {businessName}?</h1>
    <p className="lede">This will permanently remove the business and all of its analysis history. This action cannot be undone.</p>
    <section className="panel deletion-identity">
      <h2>{businessName}</h2>
      {website ? <p>{website}</p> : null}
      {geography ? <p>{geography}</p> : null}
      {duplicateName ? <p className="notice">Another business with the same name exists.</p> : null}
    </section>
    <section className="panel">
      <h2>Everything belonging to this business will be deleted</h2>
      <p>Business details, Claims, Evidence, Metrics, relationships, snapshots, source information, raw intake, proposed findings, review history, analysis history and workflow history will all be permanently removed.</p>
      <p>Type the following exactly to confirm:</p>
      <p className="confirmation-phrase"><strong>{phrase}</strong></p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <form action={permanentlyDeleteBusinessAction} className="stacked-form">
        <input type="hidden" name="businessId" value={businessId} />
        <label>Confirmation phrase<input name="confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" required /></label>
        <div className="button-row">
          <Link className="button-link secondary-link" href={`/businesses/${businessId}`}>Cancel</Link>
          <button type="submit" className="danger-button" disabled={!matches}>Permanently delete business</button>
        </div>
      </form>
    </section>
  </main>;
}
