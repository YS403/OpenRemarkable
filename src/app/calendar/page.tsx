import type { Metadata } from "next";
import { Suspense } from "react";

import { CalendarShell } from "@/components/calendar/calendar-shell";

export const metadata: Metadata = { title: "Calendar · myremarkable" };

export default function CalendarPage() {
  // the shell reads ?demo= from the URL, which needs a Suspense boundary
  return (
    <Suspense fallback={<div className="h-dvh" />}>
      <CalendarShell />
    </Suspense>
  );
}
