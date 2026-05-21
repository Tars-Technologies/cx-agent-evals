import { redirect } from "next/navigation";

export default async function RealConversationRedirect({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  redirect(`/conversations?id=${conversationId}`);
}
