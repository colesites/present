import type { Metadata } from "next";

import { InvitationClient } from "./InvitationClient";

export const metadata: Metadata = {
  title: "Invitation",
  robots: { index: false, follow: false },
};

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <InvitationClient token={decodeURIComponent(token)} />;
}
