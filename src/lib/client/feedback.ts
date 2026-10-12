import type { FeatureRequest } from "@/lib/feedback/schema";

/**
 * Feature requests. There is no backend yet, so requests are accepted locally
 * and the UI says they weren't sent. When POST /api/feedback exists, set this
 * to false and send `request` there; nothing else changes.
 */
const FEEDBACK_DEMO = true;

export async function submitFeatureRequest(request: FeatureRequest): Promise<{ sent: boolean }> {
  if (FEEDBACK_DEMO) {
    void request;
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { sent: false };
  }
  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error("Couldn't send your request. Please try again.");
  return { sent: true };
}
