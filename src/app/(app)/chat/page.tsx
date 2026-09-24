import { Chat } from "@/components/chat";
import { isAiConfigured } from "@/lib/ai/client";

export const metadata = { title: "FRIDAY AI" };

export default function ChatPage() {
  return <Chat configured={isAiConfigured()} />;
}
