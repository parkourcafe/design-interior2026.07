"use client";

export default function PrintButton({ label }: { label: string }) {
  return (
    <button onClick={() => window.print()} className="btn-ghost no-print">
      {label}
    </button>
  );
}
