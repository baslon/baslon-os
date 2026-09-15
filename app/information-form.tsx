"use client";

import { useFormStatus } from "react-dom";

function Submit() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? "Analysing information…" : "Analyse Information →"}</button>;
}

export function InformationForm({ businessId, retry, action }: {
  businessId: string;
  retry?: { id: string; rawIntakeText: string; sourceReference: string | null };
  action: (data: FormData) => Promise<void>;
}) {
  return <form action={action} className="stacked-form panel">
    <input type="hidden" name="businessId" value={businessId} />
    {retry ? <>
      <input type="hidden" name="runId" value={retry.id} />
      <p>Your submitted information is preserved. Retrying analyses the same source.</p>
      <label>Submitted information<textarea rows={14} readOnly value={retry.rawIntakeText} /></label>
      {retry.sourceReference ? <p>Source: {retry.sourceReference}</p> : null}
    </> : <>
      <label>New information<textarea name="rawText" rows={14} required /></label>
      <label>Source details <span className="field-note">Optional</span><input name="sourceReference" /></label>
    </>}
    <Submit />
  </form>;
}
