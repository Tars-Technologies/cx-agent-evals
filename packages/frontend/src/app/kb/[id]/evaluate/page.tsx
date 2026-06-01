import { redirect } from "next/navigation";

export default async function KbEvaluatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/kb/${id}/evaluate/datasets`);
}
