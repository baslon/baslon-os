"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * A button-controlled disclosure: the content is rendered but hidden until
 * opened, so it stays in the document for search and assistive technology,
 * and the state is exposed through aria-expanded.
 */
export function Disclosure({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  return <div className={className ? `disclosure ${className}` : "disclosure"}>
    <button type="button" className="disclosure-toggle" aria-expanded={open} aria-controls={regionId} onClick={() => setOpen((value) => !value)}>
      {label}
    </button>
    <div id={regionId} className="disclosure-content" hidden={!open}>{children}</div>
  </div>;
}
