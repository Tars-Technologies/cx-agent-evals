import { redirect } from "next/navigation";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; analysisId: string }>;
}) {
  const { id, analysisId } = await params;
  redirect(`/agents/${id}/evaluate/error-analysis/${analysisId}/annotate`);
}
