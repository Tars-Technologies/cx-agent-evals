import { redirect } from "next/navigation";

export default async function TranscriptRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/conversations?tab=transcripts&id=${id}`);
}
