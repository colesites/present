"use client";

import Link from "next/link";
import { BookOpenText, FolderInput, Mic, Music } from "lucide-react";
import { PlanUsageCard, useBillingStatus } from "./usage";
import { Card, Eyebrow, Page, PageHeader, buttonClass } from "./ui";

const STEPS = [
  {
    icon: FolderInput,
    title: "Bring your Bibles",
    body: "In the desktop app, open Scripture and import the translations your church is licensed to use. They stay on that computer and work offline.",
  },
  {
    icon: Mic,
    title: "Turn on the Bible agent",
    body: "It listens to the preacher through your microphone or sound desk and finds each verse as it is read, asking first when it isn't sure.",
  },
  {
    icon: BookOpenText,
    title: "Project it",
    body: "The verse goes on screen in your scripture style, in the translation you picked, without anyone typing a reference.",
  },
] as const;

/**
 * Scripture in Present. The Bibles themselves are imported on each computer,
 * so this page is about the AI projection that finds verses, and how much of
 * it is left this month.
 */
export function BibleSection() {
  const billing = useBillingStatus();
  return (
    <Page>
      <PageHeader
        eyebrow="Scripture"
        title="Bible"
        description="Put a verse on screen the moment it is read, in the translations your church uses."
      />

      <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <Eyebrow>How it works</Eyebrow>
          <ol className="mt-5 space-y-6">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-control bg-primary/10 text-primary">
                  <step.icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">
                    <span className="text-[#9aa3b2]">{index + 1}.</span> {step.title}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[#7d8798]">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <div className="grid content-start gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <PlanUsageCard status={billing} />
          {billing && !billing.limits.songAiProjection ? (
            <Card tone="soft">
              <span className="flex h-10 w-10 items-center justify-center rounded-control bg-white text-primary">
                <Music className="h-5 w-5" />
              </span>
              <p className="mt-4 font-semibold">Songs too, on Pro</p>
              <p className="mt-1 text-sm leading-6 text-[#7d8798]">
                Pro and Power find the song being sung from your library and follow it line by line.
              </p>
              <Link href="/dashboard/billing" className={`${buttonClass("primary", "sm")} mt-4 w-full`}>
                See plans
              </Link>
            </Card>
          ) : null}
        </div>
      </div>
    </Page>
  );
}
