"use client";

export default function ExperimentDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-screen">{children}</div>
  );
}
