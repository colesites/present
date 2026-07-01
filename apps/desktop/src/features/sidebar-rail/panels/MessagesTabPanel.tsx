"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { api } from "@present/backend/convex/_generated/api";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import { cn } from "../../../renderer/shared/lib/utils";
import {
  createLocalMessage,
  enqueueSyncOperation,
  listSyncQueueByOrg,
  readOrgMessages,
  removeMessageLocal,
  replaceOrgMessages,
  upsertMessage,
} from "../../../renderer/shared/offline/localData";
import type {
  MessageOverlay,
  MessageOverlayAnimation,
  MessageOverlayDismiss,
  MessageOverlayPosition,
  SavedMessage,
} from "../../../shared/types";

interface MessagesTabPanelProps {
  orgId: Id<"organizations"> | null;
  userId: string | null;
  isMessageLayerEnabled: boolean;
  activeOverlay: MessageOverlay | null;
  onShowOverlay: (overlay: MessageOverlay | null) => void;
  onSetMessageLayerEnabled: (enabled: boolean) => void;
}

const THEME_PRESETS: { key: string; label: string; swatch: string }[] = [
  { key: "default", label: "Default", swatch: "#1f2030" },
  { key: "info", label: "Info", swatch: "#2563eb" },
  { key: "warning", label: "Warning", swatch: "#f59e0b" },
  { key: "danger", label: "Alert", swatch: "#dc2626" },
  { key: "transparent", label: "Transparent", swatch: "transparent" },
];

const DISMISS_OPTIONS: {
  value: MessageOverlayDismiss;
  label: string;
}[] = [
  { value: "manual", label: "Manually" },
  { value: "after-10s", label: "After 10s" },
  { value: "after-30s", label: "After 30s" },
];

// Tokens like {name} {date} {time} substituted at Show time.
function applyTokens(body: string): string {
  const now = new Date();
  return body
    .replace(/\{date\}/gi, now.toLocaleDateString())
    .replace(/\{time\}/gi, now.toLocaleTimeString())
    .replace(/\{day\}/gi, now.toLocaleDateString(undefined, { weekday: "long" }));
}

type RemoteMessage = {
  _id: Id<"messages"> | Id<"personalMessages"> | string;
  _creationTime?: number;
  title: string;
  body: string;
  themeKey: string;
  position: MessageOverlayPosition;
  dismissMode: MessageOverlayDismiss;
  allowWebNotifications: boolean;
  animation?: MessageOverlayAnimation;
  speedSeconds?: number;
  fontScale?: number;
  order: number;
  createdAt?: number;
  updatedAt?: number;
};

const normalizeRemoteMessage = (
  workspaceId: string,
  message: RemoteMessage,
  index: number,
): SavedMessage => {
  const createdAt = message.createdAt ?? message._creationTime ?? Date.now();
  return {
    _id: message._id,
    _creationTime: message._creationTime ?? createdAt,
    orgId: workspaceId,
    title: message.title,
    body: message.body,
    themeKey: message.themeKey,
    position: message.position,
    dismissMode: message.dismissMode,
    allowWebNotifications: message.allowWebNotifications,
    animation: message.animation ?? "static",
    speedSeconds: message.speedSeconds ?? 12,
    fontScale: message.fontScale ?? 1,
    order: Number.isFinite(message.order) ? message.order : index,
    createdAt,
    updatedAt: message.updatedAt ?? createdAt,
    version: 1,
    deleted: false,
  };
};

export function MessagesTabPanel({
  orgId,
  userId,
  activeOverlay,
  onShowOverlay,
  onSetMessageLayerEnabled,
}: MessagesTabPanelProps) {
  const isOrgWorkspace = Boolean(orgId);
  const workspaceId = orgId ? String(orgId) : "personal";
  const remoteMessages = useQuery(
    isOrgWorkspace ? api.messages.listByOrg : api.messages.listByUser,
    orgId ? { orgId } : userId ? { userId } : "skip",
  ) as RemoteMessage[] | undefined;

  const [messages, setMessages] = useState<SavedMessage[]>(() =>
    readOrgMessages(workspaceId),
  );
  const [selectedId, setSelectedId] = useState<SavedMessage["_id"] | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(true);

  const refreshLocalMessages = useCallback(() => {
    setMessages(readOrgMessages(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    refreshLocalMessages();
  }, [refreshLocalMessages]);

  useEffect(() => {
    if (!remoteMessages) {
      return;
    }

    const hasPendingMessageSync = listSyncQueueByOrg(workspaceId).some(
      (item) => item.entityType === "message",
    );
    if (hasPendingMessageSync) {
      return;
    }

    replaceOrgMessages(
      workspaceId,
      remoteMessages.map((message, index) =>
        normalizeRemoteMessage(workspaceId, message, index),
      ),
    );
    refreshLocalMessages();
  }, [refreshLocalMessages, remoteMessages, workspaceId]);

  const sorted = useMemo(() => {
    return [...messages].sort((a, b) => a.order - b.order);
  }, [messages]);

  // Auto-select first message once the list loads or after a delete.
  useEffect(() => {
    let frame: number | null = null;
    if (!sorted.length) {
      frame = window.requestAnimationFrame(() => setSelectedId(null));
    } else if (!selectedId || !sorted.some((m) => m._id === selectedId)) {
      frame = window.requestAnimationFrame(() => setSelectedId(sorted[0]._id));
    }
    return () => {
      if (frame != null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [selectedId, sorted]);

  const selected = useMemo(
    () => sorted.find((m) => m._id === selectedId) ?? null,
    [selectedId, sorted],
  );

  // Local editing buffer — debounced into Convex on blur / dropdown change.
  const [draftBody, setDraftBody] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const lastSavedSelectedIdRef = useRef<SavedMessage["_id"] | null>(null);
  useEffect(() => {
    if (!selected || selected._id === lastSavedSelectedIdRef.current) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      setDraftBody(selected.body);
      setDraftTitle(selected.title);
      lastSavedSelectedIdRef.current = selected._id;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selected]);

  // Whether the currently-selected message is the one live on the output.
  // Driven solely by the active overlay (the single source of truth), not the
  // looks-layer flag, so the Show/Hide button reflects reality.
  const isActiveBeingShown =
    activeOverlay !== null &&
    selected !== null &&
    activeOverlay.id === selected._id;

  // Auto-dismiss timer when the overlay is configured to clear after N seconds.
  useEffect(() => {
    if (!activeOverlay) return;
    if (activeOverlay.dismissMode === "manual") return;
    const ms = activeOverlay.dismissMode === "after-10s" ? 10_000 : 30_000;
    const elapsed = Date.now() - activeOverlay.shownAtMs;
    const remaining = Math.max(0, ms - elapsed);
    const handle = window.setTimeout(() => {
      onShowOverlay(null);
    }, remaining);
    return () => window.clearTimeout(handle);
  }, [activeOverlay, onShowOverlay]);

  // Live edits: while a message is on the output, edits to its text, theme,
  // position, animation, etc. should update the audience output immediately —
  // no need to hide & re-show. We re-publish the overlay whenever the visible
  // content changes, preserving `shownAtMs` so the auto-dismiss countdown is
  // not restarted. A content-equality guard prevents an update loop.
  useEffect(() => {
    if (!isActiveBeingShown || !selected || !activeOverlay) return;

    const nextText = applyTokens(draftBody || selected.body).trim();
    if (!nextText) return;

    const next: MessageOverlay = {
      id: selected._id,
      text: nextText,
      position: selected.position,
      themeKey: selected.themeKey,
      dismissMode: selected.dismissMode,
      animation: selected.animation ?? "static",
      speedSeconds: selected.speedSeconds ?? 12,
      fontScale: selected.fontScale ?? 1,
      shownAtMs: activeOverlay.shownAtMs,
    };

    const unchanged =
      next.text === activeOverlay.text &&
      next.position === activeOverlay.position &&
      next.themeKey === activeOverlay.themeKey &&
      next.dismissMode === activeOverlay.dismissMode &&
      next.animation === activeOverlay.animation &&
      next.speedSeconds === activeOverlay.speedSeconds &&
      next.fontScale === activeOverlay.fontScale;
    if (unchanged) return;

    onShowOverlay(next);
  }, [isActiveBeingShown, selected, draftBody, activeOverlay, onShowOverlay]);

  const patchMessage = async (
    messageId: SavedMessage["_id"],
    patch: Partial<Omit<SavedMessage, "_id" | "order" | "allowWebNotifications">>,
  ) => {
    const existing = messages.find((message) => message._id === messageId);
    if (!existing) {
      return;
    }

    const nextMessage = upsertMessage(workspaceId, {
      ...existing,
      ...patch,
      title: patch.title?.trim() || existing.title || "New Message",
      updatedAt: Date.now(),
    });
    refreshLocalMessages();
    enqueueSyncOperation(
      workspaceId,
      "message",
      String(messageId),
      "update",
      nextMessage,
    );
  };

  const handleCreate = async () => {
    const nextOrder =
      sorted.reduce((max, message) => Math.max(max, message.order), -1) + 1;
    const commonPayload = {
      title: "New Message",
      body: "",
      themeKey: "default",
      position: "bottom",
      dismissMode: "manual",
      animation: "static",
      speedSeconds: 12,
      fontScale: 1,
      allowWebNotifications: false,
      order: nextOrder,
      createdAt: Date.now(),
      userId: isOrgWorkspace ? undefined : userId ?? undefined,
    } satisfies Omit<
      SavedMessage,
      "_id" | "_creationTime" | "orgId" | "updatedAt" | "version" | "deleted"
    >;
    const message = createLocalMessage(workspaceId, commonPayload);
    refreshLocalMessages();
    enqueueSyncOperation(
      workspaceId,
      "message",
      String(message._id),
      "create",
      message,
    );
    setSelectedId(message._id);
    setIsDetailOpen(true);
  };

  const persistBody = async () => {
    if (!selected) return;
    if (draftBody === selected.body && draftTitle === selected.title) return;
    await patchMessage(selected._id, {
      body: draftBody,
      title: draftTitle.trim() || "New Message",
    });
  };

  const handleShow = () => {
    if (!selected) return;
    const overlay: MessageOverlay = {
      id: selected._id,
      text: applyTokens(draftBody || selected.body).trim(),
      position: selected.position,
      themeKey: selected.themeKey,
      dismissMode: selected.dismissMode,
      shownAtMs: Date.now(),
      animation: selected.animation ?? "static",
      speedSeconds: selected.speedSeconds ?? 12,
      fontScale: selected.fontScale ?? 1,
    };
    if (!overlay.text) return;
    onSetMessageLayerEnabled(true);
    onShowOverlay(overlay);
  };

  const handleHide = () => {
    onShowOverlay(null);
    onSetMessageLayerEnabled(false);
  };

  const handleInsertToken = (token: string) => {
    setDraftBody((current) =>
      current.length === 0 ? `{${token}}` : `${current} {${token}}`,
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Messages list header */}
      <header className="flex items-center justify-between border-b border-border/70 px-4 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Messages
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCreate}
            className="rounded-sm p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            aria-label="New message"
            title="New message"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.6} />
          </button>
        </div>
      </header>

      {/* List */}
      <ul className="flex max-h-[40%] flex-col overflow-y-auto border-b border-border/70">
        {sorted.length === 0 ? (
          <li className="px-4 py-3 text-[11px] text-muted-foreground">
            No messages yet. Click + to create one.
          </li>
        ) : (
          sorted.map((message) => {
            const isSelected = message._id === selectedId;
            return (
              <li key={message._id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(message._id)}
                  className={cn(
                    "flex w-full items-center justify-between px-4 py-2 text-left text-[12px] transition",
                    isSelected
                      ? "bg-foreground/10 text-foreground"
                      : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                  )}
                >
                  <span className="truncate">{message.title || "Untitled"}</span>
                  {activeOverlay?.id === message._id && (
                    <span className="ml-2 inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                  )}
                </button>
              </li>
            );
          })
        )}
      </ul>

      {/* Detail */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <button
          type="button"
          onClick={() => setIsDetailOpen((open) => !open)}
          className="flex w-full items-center justify-between border-b border-border/70 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
        >
          <span className="inline-flex items-center gap-1.5">
            <Pencil className="h-3 w-3" strokeWidth={1.6} />
            Message detail
          </span>
          {isDetailOpen ? (
            <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.6} />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.6} />
          )}
        </button>

        {isDetailOpen && selected && (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <input
              type="text"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={persistBody}
              placeholder="Title"
              className="rounded-sm border border-border/70 bg-background/40 px-2 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:border-primary/60 focus:outline-hidden"
            />

            <textarea
              value={draftBody}
              onChange={(event) => setDraftBody(event.target.value)}
              onBlur={persistBody}
              placeholder="Type your message…"
              className="min-h-[120px] resize-y rounded-sm border border-border/70 bg-background/40 px-2 py-1.5 text-[12px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:border-primary/60 focus:outline-hidden"
            />

            <div className="flex flex-wrap gap-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Tokens:
              </span>
              {["name", "date", "time", "day"].map((token) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => handleInsertToken(token)}
                  className="rounded-sm border border-border/60 bg-background/40 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
                >
                  {`{${token}}`}
                </button>
              ))}
            </div>

            <Field label="Theme">
              <div className="flex flex-wrap gap-1.5">
                {THEME_PRESETS.map((theme) => (
                  <button
                    key={theme.key}
                    type="button"
                    onClick={() =>
                      void patchMessage(selected._id, {
                        themeKey: theme.key,
                      })
                    }
                    aria-pressed={selected.themeKey === theme.key}
                    title={theme.label}
                    className={cn(
                      "h-6 w-12 rounded-sm border transition",
                      selected.themeKey === theme.key
                        ? "border-primary"
                        : "border-border/60 hover:border-foreground/40",
                    )}
                    style={{
                      background:
                        theme.swatch === "transparent"
                          ? "repeating-conic-gradient(#444 0 25%, transparent 0 50%) 50% / 8px 8px"
                          : theme.swatch,
                    }}
                  />
                ))}
              </div>
            </Field>

            <Field label="Position">
              <select
                value={selected.position}
                onChange={(event) =>
                  void patchMessage(selected._id, {
                    position: event.target.value as MessageOverlayPosition,
                  })
                }
                className="rounded-sm border border-border/70 bg-background/40 px-2 py-1 text-[11px] text-foreground focus:border-primary/60 focus:outline-hidden"
              >
                <option value="bottom">Bottom</option>
                <option value="top">Top</option>
              </select>
            </Field>

            <Field label="Dismiss">
              <select
                value={selected.dismissMode}
                onChange={(event) =>
                  void patchMessage(selected._id, {
                    dismissMode: event.target.value as MessageOverlayDismiss,
                  })
                }
                className="rounded-sm border border-border/70 bg-background/40 px-2 py-1 text-[11px] text-foreground focus:border-primary/60 focus:outline-hidden"
              >
                {DISMISS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Animation">
              <select
                value={selected.animation ?? "static"}
                onChange={(event) =>
                  void patchMessage(selected._id, {
                    animation: event.target.value as MessageOverlayAnimation,
                  })
                }
                className="rounded-sm border border-border/70 bg-background/40 px-2 py-1 text-[11px] text-foreground focus:border-primary/60 focus:outline-hidden"
              >
                <option value="static">Static</option>
                <option value="marquee-left">Scroll left ◀</option>
                <option value="marquee-right">Scroll right ▶</option>
              </select>
            </Field>

            {(selected.animation === "marquee-left" ||
              selected.animation === "marquee-right") && (
              <Field label={`Speed (${selected.speedSeconds ?? 12}s)`}>
                <input
                  type="range"
                  min={3}
                  max={40}
                  step={1}
                  value={selected.speedSeconds ?? 12}
                  onChange={(event) =>
                    void patchMessage(selected._id, {
                      speedSeconds: Number(event.target.value),
                    })
                  }
                  className="w-32 accent-primary"
                />
              </Field>
            )}

            <Field
              label={`Font size (${Math.round((selected.fontScale ?? 1) * 100)}%)`}
            >
              <input
                type="range"
                min={0.5}
                max={3}
                step={0.1}
                value={selected.fontScale ?? 1}
                onChange={(event) =>
                  void patchMessage(selected._id, {
                    fontScale: Number(event.target.value),
                  })
                }
                className="w-32 accent-primary"
              />
            </Field>

            <div className="mt-auto flex items-center gap-2 border-t border-border/60 pt-3">
              <button
                type="button"
                onClick={() => {
                  removeMessageLocal(workspaceId, String(selected._id));
                  refreshLocalMessages();
                  enqueueSyncOperation(
                    workspaceId,
                    "message",
                    String(selected._id),
                    "delete",
                    { id: selected._id },
                  );
                  if (activeOverlay?.id === selected._id) onShowOverlay(null);
                }}
                className="flex h-9 items-center gap-1.5 rounded-sm border border-border/70 bg-background/40 px-2.5 text-[11px] text-muted-foreground hover:border-red-500/60 hover:text-red-400"
                aria-label="Delete message"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.6} />
              </button>
              <div className="flex-1" />
              {isActiveBeingShown ? (
                <button
                  type="button"
                  onClick={handleHide}
                  className="flex h-9 items-center gap-1.5 rounded-sm bg-red-500/90 px-3 text-[11px] font-semibold text-white hover:bg-red-500"
                >
                  <Send className="h-3.5 w-3.5" strokeWidth={1.8} />
                  Hide
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    void persistBody();
                    handleShow();
                  }}
                  disabled={!draftBody.trim()}
                  className={cn(
                    "flex h-9 items-center gap-1.5 rounded-sm px-3 text-[11px] font-semibold transition",
                    draftBody.trim()
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "cursor-not-allowed bg-foreground/10 text-muted-foreground",
                  )}
                >
                  <Send className="h-3.5 w-3.5" strokeWidth={1.8} />
                  Show
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}
