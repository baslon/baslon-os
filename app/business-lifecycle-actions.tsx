"use client";

import type { FormEvent } from "react";
import { archiveBusinessAction, restoreBusinessAction } from "./actions";

export function confirmArchiveBusiness(
  businessName: string,
  confirm: (message: string) => boolean = globalThis.confirm,
) {
  return confirm(`Archive ${businessName}? Its data and history will be preserved.`);
}

export function ArchiveBusinessAction({ businessId, businessName }: { businessId: string; businessName: string }) {
  function confirmArchive(event: FormEvent<HTMLFormElement>) {
    if (!confirmArchiveBusiness(businessName)) {
      event.preventDefault();
    }
  }

  return <form action={archiveBusinessAction} onSubmit={confirmArchive}>
    <input type="hidden" name="businessId" value={businessId} />
    <button type="submit" className="secondary">Archive business</button>
  </form>;
}

export function RestoreBusinessAction({ businessId }: { businessId: string }) {
  return <form action={restoreBusinessAction}>
    <input type="hidden" name="businessId" value={businessId} />
    <button type="submit">Restore business</button>
  </form>;
}
