import Link from "next/link";
import { notFound } from "next/navigation";
import { runEvidenceExtractionAction } from "../../../actions";
import { getBusinessService } from "@/foundation";

export const dynamic = "force-dynamic";

export default async function BusinessIntakePage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { businessId } = await params;
  const { error } = await searchParams;
  const business = (await getBusinessService().list()).find((item) => item.id === businessId);
  if (!business) notFound();

  return (
    <main>
      <p><Link href="/">← Businesses</Link></p>
      <p className="eyebrow">Business Intake</p>
      <h1 className="page-title">{business.name}</h1>
      <p>Paste the business information as it currently exists. It does not need to be structured.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <form action={runEvidenceExtractionAction} className="stacked-form">
        <input type="hidden" name="businessId" value={business.id} />
        <label>
          Messy intake
          <textarea name="rawIntakeText" rows={18} required />
        </label>
        <label>
          Source reference (optional)
          <input name="sourceReference" placeholder="Interview notes, intake form, email…" />
        </label>
        <button type="submit">Run Evidence Extraction</button>
      </form>
      <p className="note">AI output creates review proposals only. It does not update Evidence State.</p>
    </main>
  );
}
