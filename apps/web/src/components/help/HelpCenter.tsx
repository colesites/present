"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronDown, Copy, Mail, MessageSquare, Search, X } from "lucide-react";

export const SUPPORT_EMAIL = "support.present@multivrs.space";

/** Anything on the page can open the panel: `openHelp()`. */
const OPEN_HELP_EVENT = "present:open-help";
export const openHelp = () => window.dispatchEvent(new Event(OPEN_HELP_EVENT));

/**
 * "How can we help?": answers to what people ask most, and an email to the
 * team when those don't cover it, written in the visitor's own mail app.
 *
 * The answers say only what the product does today; change one when the
 * product changes.
 */

const ANSWERS: Array<{ question: string; answer: string; keywords?: string }> = [
  {
    question: "Does Present work without internet?",
    answer:
      "Yes. Your library, services and Bibles are kept on the computer, so a service runs with no connection. Changes sync to the rest of your team when you're back online.",
    keywords: "offline wifi connection",
  },
  {
    question: "Which computers does it run on?",
    answer: "Mac (Apple Silicon and Intel), Windows and Linux. Get it from the download page.",
    keywords: "mac windows linux download install",
  },
  {
    question: "How do I add Bible translations?",
    answer:
      "In the desktop app, open Scripture and import the translations your church is licensed to use. They stay on that computer and work offline.",
    keywords: "bible scripture version kjv niv import",
  },
  {
    question: "What are the Bible and song AI agents?",
    answer:
      "The Bible AI agent listens through your microphone or sound desk and puts the verse being read on screen, asking first when it isn't sure. On Pro and Power, the song AI agent finds the song from your library by voice too. Each plan includes some hours of AI projection a month.",
    keywords: "agent speech listen voice ai projection minutes hours bible song",
  },
  {
    question: "How do I invite my team?",
    answer:
      "In the dashboard, open Members and invite people by email with a role. They get an email, and see the invitation in the desktop app when they sign in.",
    keywords: "members invite team volunteer admin join",
  },
  {
    question: "Can I send the output to a livestream?",
    answer: "Yes. Present can send the audience screen over NDI, for OBS, vMix and other streaming software.",
    keywords: "stream obs vmix ndi broadcast",
  },
  {
    question: "How do I change or cancel my plan?",
    answer:
      "In the dashboard, open Billing. Moving up is charged the difference for the rest of the period. Cancelling keeps your plan until the period you paid for ends.",
    keywords: "billing plan cancel upgrade downgrade refund pro power",
  },
  {
    question: "Are my videos and images uploaded?",
    answer: "No. Media stays on the computer it's on.",
    keywords: "media video upload storage cloud",
  },
  {
    question: "Can I use Present for more than one church or event?",
    answer: "Yes. Create or join as many organizations as you need and switch between them from the dashboard or the app.",
    keywords: "organization workspace switch multiple",
  },
];

const TOPICS = [
  { value: "question", label: "Question" },
  { value: "problem", label: "Something's wrong" },
  { value: "billing", label: "Billing" },
  { value: "idea", label: "Idea" },
] as const;

/** The floating button for the public pages, with its panel. */
export function HelpButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_HELP_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_HELP_EVENT, onOpen);
  }, []);
  return (
    <>
      {open ? null : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-white font-semibold text-black shadow-[0_10px_40px_rgba(0,0,0,0.5)] transition-transform hover:scale-105 md:bottom-6 md:right-6 md:h-14 md:w-auto md:gap-3 md:px-6"
          aria-label="How can we help?"
        >
          <MessageSquare className="h-5 w-5 shrink-0 text-primary" />
          <span className="hidden md:inline">How can we help?</span>
        </button>
      )}
      <HelpPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}

type View = "answers" | "message" | "sent";

export function HelpPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-label="Help"
      className="fixed inset-x-2 bottom-2 z-[70] flex max-h-[calc(100dvh-1rem)] flex-col overflow-hidden rounded-[16px] bg-white text-[#1d2240] shadow-[0_24px_70px_rgba(0,0,0,0.45)] sm:inset-x-auto sm:bottom-6 sm:right-6 sm:max-h-[min(640px,calc(100dvh-3rem))] sm:w-[380px]"
    >
      {/* Mounted per opening, so it always starts at the answers. */}
      <HelpBody onClose={onClose} />
    </div>
  );
}

function HelpBody({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<View>("answers");

  return (
    <>
      <header className="flex items-center gap-2 border-b border-[#eceef3] px-4 py-3">
        {view === "message" ? (
          <button
            type="button"
            onClick={() => setView("answers")}
            aria-label="Back to answers"
            className="-ml-1 flex h-8 w-8 items-center justify-center rounded-[8px] text-[#6b7285] hover:bg-[#f1f2f6]"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : null}
        <p className="flex-1 font-semibold">{view === "message" ? "Email us" : "How can we help?"}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[#6b7285] hover:bg-[#f1f2f6]"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      {view === "answers" ? <Answers onMessage={() => setView("message")} /> : null}
      {view === "message" ? <MessageForm onOpened={() => setView("sent")} /> : null}
      {view === "sent" ? (
        <div className="px-5 py-8 text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#eceefb] text-[#3c418f]">
            <Mail className="h-5 w-5" />
          </span>
          <p className="mt-4 font-semibold">Finish it in your email app</p>
          <p className="mx-auto mt-1 max-w-[18rem] text-sm leading-6 text-[#6b7285]">
            Your message is written there, ready to send. If nothing opened, write to us at the address below.
          </p>
          <div className="mt-4">
            <CopyAddress />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-5 h-10 rounded-[10px] border border-[#dfe2ea] px-4 text-sm font-medium hover:bg-[#fafbfc]"
          >
            Done
          </button>
        </div>
      ) : null}
    </>
  );
}

function Answers({ onMessage }: { onMessage: () => void }) {
  const [query, setQuery] = useState("");
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const visible = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return ANSWERS.map((entry, index) => ({ ...entry, index })).filter((entry) => {
      if (words.length === 0) return true;
      const haystack = `${entry.question} ${entry.answer} ${entry.keywords ?? ""}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [query]);

  return (
    <>
      <div className="px-4 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa1b1]" />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpenIndex(null);
            }}
            placeholder="Search answers"
            aria-label="Search answers"
            autoFocus
            className="h-10 w-full rounded-[10px] border border-[#dfe2ea] pl-9 pr-3 text-[0.95rem] outline-none placeholder:text-[#a6adbb] focus:border-primary/60 focus:ring-[3px] focus:ring-primary/15"
          />
        </div>
      </div>
      <ul className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {visible.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-[#6b7285]">No answer matches. Send us a message instead.</li>
        ) : (
          visible.map((entry) => {
            const expanded = openIndex === entry.index || visible.length === 1;
            return (
              <li key={entry.question}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpenIndex(expanded ? null : entry.index)}
                  className="flex w-full items-start gap-2 rounded-[8px] px-3 py-2.5 text-left text-sm font-medium hover:bg-[#f5f6f9]"
                >
                  <span className="flex-1">{entry.question}</span>
                  <ChevronDown className={`mt-0.5 h-4 w-4 flex-none text-[#9aa1b1] transition ${expanded ? "rotate-180" : ""}`} />
                </button>
                {expanded ? <p className="px-3 pb-3 text-sm leading-6 text-[#6b7285]">{entry.answer}</p> : null}
              </li>
            );
          })
        )}
      </ul>
      <footer className="border-t border-[#eceef3] px-4 py-3">
        <button
          type="button"
          onClick={onMessage}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-primary text-sm font-medium text-white hover:bg-primary/90"
        >
          <Mail className="h-4 w-4" /> Email us
        </button>
        <p className="mt-2.5 text-center text-xs text-[#9aa1b1]">
          <Link href="/download" className="hover:text-[#1d2240]">
            Download
          </Link>
          <span> · </span>
          <Link href="/pricing" className="hover:text-[#1d2240]">
            Pricing
          </Link>
        </p>
      </footer>
    </>
  );
}

/** The support address, with a way to copy it for anyone whose email isn't on this device. */
function CopyAddress() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(SUPPORT_EMAIL).catch(() => undefined);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }}
      className="inline-flex items-center gap-2 rounded-[8px] bg-[#f1f2f6] px-3 py-1.5 text-sm hover:bg-[#e8eaf0]"
      title="Copy the address"
    >
      {SUPPORT_EMAIL}
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-[#9aa1b1]" />}
    </button>
  );
}

/**
 * The message is written here and sent from the visitor's own mail app, to
 * the support address, so the reply goes straight back to them.
 */
function MessageForm({ onOpened }: { onOpened: () => void }) {
  const [topic, setTopic] = useState<string>("question");
  const [message, setMessage] = useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const label = TOPICS.find((option) => option.value === topic)?.label ?? "Question";
    const firstLine = message.trim().split("\n")[0].slice(0, 60);
    const subject = `${label}: ${firstLine}`;
    const body = `${message.trim()}\n\n(Sent from ${window.location.host}${window.location.pathname})`;
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    onOpened();
  };

  return (
    <form onSubmit={submit} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Topic">
        {TOPICS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={topic === option.value}
            onClick={() => setTopic(option.value)}
            className={`h-8 rounded-[8px] px-3 text-sm transition-colors ${
              topic === option.value ? "bg-[#1d2240] text-white" : "bg-[#f1f2f6] text-[#6b7285] hover:text-[#1d2240]"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <textarea
        required
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder={topic === "problem" ? "What happened, and what did you expect?" : "How can we help?"}
        aria-label="Message"
        rows={7}
        className="w-full resize-none rounded-[10px] border border-[#dfe2ea] px-3 py-2.5 text-[0.95rem] leading-6 outline-none placeholder:text-[#a6adbb] focus:border-primary/60 focus:ring-[3px] focus:ring-primary/15"
        autoFocus
      />
      <button
        type="submit"
        disabled={message.trim().length < 3}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-primary text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
      >
        <Mail className="h-4 w-4" /> Write it in my email app
      </button>
      <p className="text-center text-xs leading-5 text-[#9aa1b1]">
        It goes to {SUPPORT_EMAIL} from your own email, so we can reply to you.
      </p>
    </form>
  );
}

/** A link-styled button that opens the help panel, for footers and menus. */
export function HelpLink({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={openHelp} className={className}>
      {children}
    </button>
  );
}
