"use client";

export function ExportButton({
  data,
  filename,
}: {
  data: unknown;
  filename: string;
}) {
  function handleExport() {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={handleExport}
      className="text-[10px] text-text-muted hover:text-accent border border-border rounded px-2 py-0.5 transition-colors"
    >
      Export JSON
    </button>
  );
}
