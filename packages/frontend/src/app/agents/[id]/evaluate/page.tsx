import { redirect } from "next/navigation";

export default async function EvaluateIndex({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/agents/${id}/evaluate/scenarios`);
}
