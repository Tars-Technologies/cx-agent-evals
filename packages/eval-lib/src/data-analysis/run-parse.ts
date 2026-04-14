import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, basename } from "node:path";
import { parseCSV, parseCLIArgs } from "./csv-parser.js";
import { parseTranscript } from "./transcript-parser.js";
import type { RawConversation, RawTranscriptsFile } from "./types.js";

async function main() {
  const { input, output } = parseCLIArgs(process.argv);

  console.error(`[parse] Reading CSV: ${input}`);
  const conversations: RawConversation[] = [];
  let count = 0;

  for await (const row of parseCSV(input)) {
    count++;
    if (count % 5000 === 0) console.error(`[parse] Processed ${count} rows...`);

    const messages = parseTranscript(row["Transcript"] || "");
    const labels = (row["Labels"] || "")
      .split(",")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    conversations.push({
      conversationId: row["Conversation ID"] || "",
      visitorId: row["Visitor ID"] || "",
      visitorName: row["Visitor Name"] || "",
      visitorPhone: row["Visitor Phone"] || "",
      visitorEmail: row["Visitor Email"] || "",
      agentId: row["Agent ID"] || "",
      agentName: row["Agent Name"] || "",
      agentEmail: row["Agent Email"] || "",
      inbox: row["Inbox"] || "",
      labels,
      status: row["Status"] || "",
      messages,
      metadata: {
        messageCountVisitor: parseInt(row["Number of messages sent by the visitor"] || "0", 10),
        messageCountAgent: parseInt(row["Number of messages sent by the agent"] || "0", 10),
        totalDurationSeconds: parseInt(row["Total Conversation duration in Seconds"] || "0", 10),
        startDate: row["Start Date"] || "",
        startTime: row["Start Time"] || "",
        replyDate: row["Reply Date"] || "",
        replyTime: row["Reply Time"] || "",
        lastActivityDate: row["Last Activity Date"] || "",
        lastActivityTime: row["Last Activity Time"] || "",
      },
    });
  }

  const file: RawTranscriptsFile = {
    source: basename(input),
    generatedAt: new Date().toISOString(),
    totalConversations: conversations.length,
    conversations,
  };

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(file, null, 2));
  console.error(`[parse] Written ${conversations.length} conversations to: ${output}`);
}

main().catch((err) => {
  console.error("[parse] Error:", err);
  process.exit(1);
});
