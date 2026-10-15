import type { Metadata } from "next";

import { AppStoreShell } from "@/components/app-store/app-store-shell";

export const metadata: Metadata = { title: "App Store · OpenRemarkable" };

export default function AppStorePage() {
  return <AppStoreShell />;
}
