import type { Metadata } from "next";
import { Suspense } from "react";

import { PlannerShell } from "@/components/planner/planner-shell";

export const metadata: Metadata = { title: "Planner · OpenRemarkable" };

export default function CalendarPage() {
  // the shell reads ?demo= from the URL, which needs a Suspense boundary
  return (
    <Suspense fallback={<div className="h-dvh" />}>
      <PlannerShell />
    </Suspense>
  );
}
