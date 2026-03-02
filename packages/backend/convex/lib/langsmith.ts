export async function getLangSmithClient(): Promise<any> {
  const { Client } = await import("langsmith");
  return new Client();
}
