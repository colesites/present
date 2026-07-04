"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  ImagePlus,
  Layers,
  Link as LinkIcon,
  Loader2,
  Radio,
  RefreshCw,
  Trash2,
  Type as TypeIcon,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@present/backend/convex/_generated/api";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import type { PropsOverlayItem } from "../../../shared/types/output-window";
import type { MediaItem } from "../../media/hooks";
import { cn } from "../../../renderer/shared/lib/utils";
import { runAuthenticatedConvexMutation } from "../../../renderer/shared/lib/authenticated-convex-mutation";

interface LayersTabPanelProps {
  orgId: Id<"organizations"> | null;
  mediaItems: MediaItem[];
  activePropIds: string[];
  onSetLivePropDraft: (
    propId: string,
    patch: Partial<PropsOverlayItem> & { name?: string },
  ) => void;
  onClearLivePropDraft: (propId: string) => void;
  onSetActivePropIds: (ids: string[]) => void;
}

type Prop = {
  _id: Id<"props">;
  name: string;
  kind: "image" | "text" | "video" | "youtube" | "ndi" | "capture";
  mediaId?: string;
  imageUrl?: string;
  mediaUrl?: string;
  youtubeUrl?: string;
  ndiSourceName?: string;
  captureDeviceId?: string;
  captureDeviceLabel?: string;
  text?: string;
  position:
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | "center"
    | "full";
  opacity: number;
  sizePercent: number;
  color?: string;
  fontSize?: number;
  order: number;
};

type NdiSource = {
  name: string;
  urlAddress?: string;
};

type CaptureDevice = {
  deviceId: string;
  label: string;
};

type PropDraft = Partial<
  Pick<
    Prop,
    | "color"
    | "captureDeviceId"
    | "captureDeviceLabel"
    | "fontSize"
    | "mediaId"
    | "name"
    | "ndiSourceName"
    | "opacity"
    | "position"
    | "sizePercent"
    | "text"
    | "youtubeUrl"
  >
>;

const POSITIONS: Prop["position"][] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "center",
  "full",
];

const PROPS_CACHE_KEY_PREFIX = "present-props-cache-v1:";

function readCachedProps(orgId: Id<"organizations"> | null): Prop[] {
  if (!orgId || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(
      `${PROPS_CACHE_KEY_PREFIX}${String(orgId)}`,
    );
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as Prop[]) : [];
  } catch {
    return [];
  }
}

function writeCachedProps(orgId: Id<"organizations"> | null, props: Prop[]) {
  if (!orgId || typeof window === "undefined") return;
  window.localStorage.setItem(
    `${PROPS_CACHE_KEY_PREFIX}${String(orgId)}`,
    JSON.stringify(props),
  );
}

export function LayersTabPanel({
  orgId,
  mediaItems,
  activePropIds,
  onSetLivePropDraft,
  onClearLivePropDraft,
  onSetActivePropIds,
}: LayersTabPanelProps) {
  const props = useQuery(
    api.props.listByOrg,
    orgId ? { orgId } : "skip",
  ) as Prop[] | undefined;
  const createProp = useMutation(api.props.create);
  const updateProp = useMutation(api.props.update);
  const moveProp = useMutation(api.props.move);
  const removeProp = useMutation(api.props.remove);

  const [selectedId, setSelectedId] = useState<Id<"props"> | null>(null);
  const [drafts, setDrafts] = useState<Record<string, PropDraft>>({});
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [isMediaPickerOpen, setIsMediaPickerOpen] = useState(false);
  const [isVideoSourceMenuOpen, setIsVideoSourceMenuOpen] = useState(false);
  const [ndiSources, setNdiSources] = useState<NdiSource[]>([]);
  const [isLoadingNdiSources, setIsLoadingNdiSources] = useState(false);
  const [captureDevices, setCaptureDevices] = useState<CaptureDevice[]>([]);
  const [isLoadingCaptureDevices, setIsLoadingCaptureDevices] = useState(false);
  const cachedProps = useMemo(() => readCachedProps(orgId), [orgId]);

  useEffect(() => {
    if (!props) return;
    writeCachedProps(orgId, props);
  }, [orgId, props]);

  const displayProps = props ?? cachedProps;
  const isHydrating = props === undefined;

  const sorted = useMemo(
    () => [...displayProps].sort((a, b) => a.order - b.order),
    [displayProps],
  );

  const effectiveSelectedId =
    selectedId && sorted.some((item) => item._id === selectedId)
      ? selectedId
      : sorted[0]?._id ?? null;
  const selected = useMemo(
    () => sorted.find((p) => p._id === effectiveSelectedId) ?? null,
    [effectiveSelectedId, sorted],
  );
  const selectedDraft = selected
    ? drafts[selected._id as unknown as string] ?? {}
    : {};
  const selectedView = selected ? { ...selected, ...selectedDraft } : null;
  const mediaById = useMemo(
    () => new Map(mediaItems.map((item) => [item.id, item])),
    [mediaItems],
  );

  const setPropDraft = (propId: Id<"props">, patch: PropDraft) => {
    const key = propId as unknown as string;
    onSetLivePropDraft(key, patch);
    setDrafts((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] ?? {}),
        ...patch,
      },
    }));
  };

  const commitPropUpdate = (propId: Id<"props">, patch: PropDraft) => {
    setPropDraft(propId, patch);
    const args = {
      propId,
      ...patch,
    };
    void runAuthenticatedConvexMutation(api.props.update, args, () =>
      updateProp(args),
    ).then(() => {
      const key = propId as unknown as string;
      onClearLivePropDraft(key);
      setDrafts((prev) => {
        const nextDraft = { ...(prev[key] ?? {}) };
        Object.keys(patch).forEach((field) => {
          delete nextDraft[field as keyof PropDraft];
        });
        if (Object.keys(nextDraft).length === 0) {
          const rest = { ...prev };
          delete rest[key];
          return rest;
        }
        return { ...prev, [key]: nextDraft };
      });
    }).catch((error: unknown) => {
      toast.error("Could not save prop changes.");
      console.error("Failed to update prop", error);
    });
  };

  const loadNdiSources = async () => {
    if (!window.electronAPI?.listNdiSources) return;
    setIsLoadingNdiSources(true);
    await window.electronAPI
      .listNdiSources()
      .then((result) => {
        setNdiSources(result.sources);
      })
      .catch((error: unknown) => {
        console.error("Failed to list NDI sources", error);
      });
    setIsLoadingNdiSources(false);
  };

  const loadCaptureDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setCaptureDevices([]);
      return;
    }

    setIsLoadingCaptureDevices(true);
    let temporaryStream: MediaStream | null = null;

    try {
      const permission = await window.electronAPI?.requestCameraAccess?.();
      if (permission && !permission.granted) {
        toast.error("Camera/capture access is blocked in system settings.");
        setCaptureDevices([]);
        setIsLoadingCaptureDevices(false);
        return;
      }

      let devices = await navigator.mediaDevices.enumerateDevices();
      const needsLabels = devices.some(
        (device) => device.kind === "videoinput" && !device.label,
      );

      if (needsLabels && navigator.mediaDevices.getUserMedia) {
        temporaryStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        devices = await navigator.mediaDevices.enumerateDevices();
      }

      const videoInputs = devices
        .filter((device) => device.kind === "videoinput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label:
            device.label?.trim() ||
            `Video input ${index + 1}`,
        }));

      setCaptureDevices(videoInputs);
      temporaryStream?.getTracks().forEach((track) => track.stop());
      setIsLoadingCaptureDevices(false);
    } catch (error) {
      temporaryStream?.getTracks().forEach((track) => track.stop());
      setCaptureDevices([]);
      setIsLoadingCaptureDevices(false);
      toast.error("Could not read HDMI/capture devices.");
      console.error("Failed to list capture devices", error);
    }
  };

  if (!orgId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[11px] text-muted-foreground">
        Join or select an organization to manage props.
      </div>
    );
  }

  const toggleVisible = (id: Id<"props">) => {
    const idStr = id as unknown as string;
    if (activePropIds.includes(idStr)) {
      onSetActivePropIds(activePropIds.filter((x) => x !== idStr));
    } else {
      onSetActivePropIds([...activePropIds, idStr]);
    }
  };

  const handleCreateMedia = (item: MediaItem) => {
    const toastId = toast.loading("Adding media prop...");
    setPendingAction("create-media");
    const args = {
      orgId,
      name: item.name.replace(/\.[^.]+$/, "") || item.name,
      kind: item.type,
      mediaId: item.id,
      position: item.type === "video" ? "center" : "bottom-right",
      opacity: 1,
      sizePercent: item.type === "video" ? 45 : 20,
    } as const;
    void runAuthenticatedConvexMutation(api.props.create, args, () =>
      createProp(args),
    ).then((id) => {
      setSelectedId(id);
      setIsMediaPickerOpen(false);
      toast.success("Media prop added.", { id: toastId });
    }).catch((error: unknown) => {
      toast.error("Could not add media prop.", { id: toastId });
      console.error("Failed to create media prop", error);
    }).then(() => {
      setPendingAction(null);
    });
  };

  const handleCreateYoutube = async () => {
    setIsVideoSourceMenuOpen(false);
    const toastId = toast.loading("Adding YouTube prop...");
    setPendingAction("create-youtube");
    const args = {
      orgId,
      name: "YouTube video",
      kind: "youtube",
      youtubeUrl: "",
      position: "center",
      opacity: 1,
      sizePercent: 45,
    } as const;
    void runAuthenticatedConvexMutation(api.props.create, args, () =>
      createProp(args),
    ).then((id) => {
      setSelectedId(id);
      toast.success("YouTube prop added.", { id: toastId });
    }).catch((error: unknown) => {
      toast.error("Could not add YouTube prop.", { id: toastId });
      console.error("Failed to create YouTube prop", error);
    }).then(() => {
      setPendingAction(null);
    });
  };

  const handleCreateNdi = async () => {
    setIsVideoSourceMenuOpen(false);
    const toastId = toast.loading("Adding NDI prop...");
    setPendingAction("create-ndi");
    const args = {
      orgId,
      name: "NDI source",
      kind: "ndi",
      ndiSourceName: "",
      position: "center",
      opacity: 1,
      sizePercent: 55,
    } as const;
    void runAuthenticatedConvexMutation(api.props.create, args, () =>
      createProp(args),
    ).then((id) => {
      setSelectedId(id);
      toast.success("NDI prop added.", { id: toastId });
      void loadNdiSources();
    }).catch((error: unknown) => {
      toast.error("Could not add NDI prop.", { id: toastId });
      console.error("Failed to create NDI prop", error);
    }).then(() => {
      setPendingAction(null);
    });
  };

  const handleCreateCapture = async () => {
    setIsVideoSourceMenuOpen(false);
    const toastId = toast.loading("Adding HDMI capture prop...");
    setPendingAction("create-capture");
    const args = {
      orgId,
      name: "HDMI capture",
      kind: "capture",
      captureDeviceId: "",
      captureDeviceLabel: "",
      position: "center",
      opacity: 1,
      sizePercent: 55,
    } as const;
    void runAuthenticatedConvexMutation(api.props.create, args, () =>
      createProp(args),
    ).then((id) => {
      setSelectedId(id);
      toast.success("HDMI capture prop added.", { id: toastId });
      void loadCaptureDevices();
    }).catch((error: unknown) => {
      toast.error("Could not add HDMI capture prop.", { id: toastId });
      console.error("Failed to create HDMI capture prop", error);
    }).then(() => {
      setPendingAction(null);
    });
  };

  const handleCreateText = async () => {
    const toastId = toast.loading("Adding text prop...");
    setPendingAction("create-text");
    const args = {
      orgId,
      name: "Text prop",
      kind: "text",
      text: "Live",
      position: "top-right",
      opacity: 1,
      sizePercent: 30,
      color: "#ffffff",
      fontSize: 48,
    } as const;
    void runAuthenticatedConvexMutation(api.props.create, args, () =>
      createProp(args),
    ).then((id) => {
      setSelectedId(id);
      toast.success("Text prop added.", { id: toastId });
    }).catch((error: unknown) => {
      toast.error("Could not add text prop.", { id: toastId });
      console.error("Failed to create text prop", error);
    }).then(() => {
      setPendingAction(null);
    });
  };

  const handleMoveProp = (propId: Id<"props">, direction: "up" | "down") => {
    const key = propId as unknown as string;
    const args = { propId, direction };
    setPendingAction(`move-${key}-${direction}`);
    void runAuthenticatedConvexMutation(api.props.move, args, () =>
      moveProp(args),
    )
      .catch((error: unknown) => {
        toast.error("Could not reorder prop.");
        console.error("Failed to reorder prop", error);
      })
      .then(() => {
        setPendingAction(null);
      });
  };

  const handleDeleteProp = (propId: Id<"props">) => {
    const key = propId as unknown as string;
    const toastId = toast.loading("Deleting prop...");
    const args = { propId };
    setPendingAction(`delete-${key}`);
    void runAuthenticatedConvexMutation(api.props.remove, args, () =>
      removeProp(args),
    )
      .then(() => {
        onSetActivePropIds(activePropIds.filter((id) => id !== key));
        onClearLivePropDraft(key);
        setSelectedId(null);
        toast.success("Prop deleted.", { id: toastId });
      })
      .catch((error: unknown) => {
        toast.error("Could not delete prop.", { id: toastId });
        console.error("Failed to delete prop", error);
      })
      .then(() => {
        setPendingAction(null);
      });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex items-center justify-between px-3 py-2">
        <p className="text-[11px] font-medium text-foreground">Props</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setIsVideoSourceMenuOpen(false);
              setIsMediaPickerOpen((value) => !value);
            }}
            disabled={Boolean(pendingAction)}
            className="rounded-sm p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground disabled:opacity-50"
            title="Add media file"
            aria-label="Add media file"
          >
            {pendingAction === "create-media" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
            ) : (
              <ImagePlus className="h-3.5 w-3.5" strokeWidth={1.8} />
            )}
          </button>
          <button
            type="button"
            onClick={handleCreateText}
            disabled={Boolean(pendingAction)}
            className="rounded-sm p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground disabled:opacity-50"
            title="Add text prop"
            aria-label="Add text prop"
          >
            {pendingAction === "create-text" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
            ) : (
              <TypeIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
            )}
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setIsMediaPickerOpen(false);
                setIsVideoSourceMenuOpen((value) => !value);
              }}
              disabled={Boolean(pendingAction)}
              className="inline-flex items-center gap-0.5 rounded-sm p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground disabled:opacity-50"
              title="Add video source"
              aria-label="Add video source"
              aria-expanded={isVideoSourceMenuOpen}
            >
              {pendingAction === "create-youtube" ||
              pendingAction === "create-ndi" ||
              pendingAction === "create-capture" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
              ) : (
                <Video className="h-3.5 w-3.5" strokeWidth={1.8} />
              )}
              <ChevronDown className="h-3 w-3" strokeWidth={1.8} />
            </button>
            {isVideoSourceMenuOpen ? (
              <div className="absolute right-0 top-7 z-30 w-48 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
                <button
                  type="button"
                  onClick={() => void handleCreateYoutube()}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[11px] hover:bg-muted"
                >
                  <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.7} />
                  YouTube link
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreateNdi()}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[11px] hover:bg-muted"
                >
                  <Radio className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.7} />
                  NDI network source
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreateCapture()}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[11px] hover:bg-muted"
                >
                  <Camera className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.7} />
                  HDMI / capture card
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {isMediaPickerOpen ? (
        <div className="border-b border-border/70 p-2">
          <p className="mb-1 px-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Media files
          </p>
          <div className="max-h-36 overflow-y-auto rounded-sm border border-border/60 bg-background/40 p-1">
            {mediaItems.length ? (
              mediaItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleCreateMedia(item)}
                  disabled={Boolean(pendingAction)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-foreground/5 disabled:opacity-50"
                >
                  <MediaPropThumb item={item} className="h-7 w-10 shrink-0 rounded-sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] text-foreground">
                      {item.name}
                    </span>
                    <span className="block text-[9px] text-muted-foreground">
                      {item.type}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <p className="px-2 py-3 text-[10px] text-muted-foreground">
                Add media in the Media panel first.
              </p>
            )}
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
        {sorted.length === 0 && isHydrating ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
            <Loader2
              className="h-5 w-5 animate-spin text-muted-foreground/70"
              strokeWidth={1.6}
            />
            <p className="text-[11px] text-muted-foreground">Loading props...</p>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
            <Layers
              className="h-8 w-8 text-muted-foreground/60"
              strokeWidth={1.4}
            />
            <p className="text-[11px] text-muted-foreground">
              No props yet. Add media, text, or a video source.
            </p>
          </div>
        ) : (
          sorted.map((prop, index) => {
            const isVisible = activePropIds.includes(prop._id as unknown as string);
            const propKey = prop._id as unknown as string;
            const propMedia = prop.mediaId ? mediaById.get(prop.mediaId) ?? null : null;
            return (
              <div
                key={prop._id}
                className={cn(
                  "group flex min-h-9 items-center gap-2 rounded-sm border px-2 py-1.5 transition",
                  selectedId === prop._id
                    ? "border-primary"
                    : "border-border/40 hover:border-foreground/40",
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(prop._id)}
                  aria-pressed={selectedId === prop._id}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <div
                    className="relative flex h-7 w-9 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-[repeating-conic-gradient(#1a1a1a_0_25%,#2a2a2a_0_50%)] bg-[length:8px_8px]"
                    style={{ opacity: prop.opacity }}
                  >
                    {propMedia ? (
                      <MediaPropThumb item={propMedia} className="h-full w-full" />
                    ) : prop.kind === "image" && prop.imageUrl ? (
                      <img
                        src={prop.imageUrl}
                        alt=""
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : prop.kind === "video" ? (
                      <Video className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.7} />
                    ) : prop.kind === "youtube" ? (
                      <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.7} />
                    ) : prop.kind === "ndi" ? (
                      <Radio className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.7} />
                    ) : prop.kind === "capture" ? (
                      <Camera className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.7} />
                    ) : (
                      <span
                        className="px-1 text-center font-semibold leading-none"
                        style={{
                          color: prop.color ?? "white",
                          fontSize: "10px",
                        }}
                      >
                        T
                      </span>
                    )}
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] text-foreground">
                      {prop.name}
                    </span>
                    <span className="block truncate text-[9px] text-muted-foreground">
                      {prop.kind === "youtube"
                        ? prop.youtubeUrl || "YouTube source"
                        : prop.kind === "ndi"
                          ? prop.ndiSourceName || "NDI source"
                          : prop.kind === "capture"
                            ? prop.captureDeviceLabel || "HDMI capture"
                          : propMedia?.name ?? prop.kind}
                    </span>
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => handleMoveProp(prop._id, "up")}
                    disabled={index === 0 || Boolean(pendingAction)}
                    aria-label="Move prop up"
                    className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    title="Move up"
                  >
                    {pendingAction === `move-${propKey}-up` ? (
                      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.8} />
                    ) : (
                      <ChevronUp className="h-3 w-3" strokeWidth={1.8} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveProp(prop._id, "down")}
                    disabled={index === sorted.length - 1 || Boolean(pendingAction)}
                    aria-label="Move prop down"
                    className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    title="Move down"
                  >
                    {pendingAction === `move-${propKey}-down` ? (
                      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.8} />
                    ) : (
                      <ChevronDown className="h-3 w-3" strokeWidth={1.8} />
                    )}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleVisible(prop._id);
                  }}
                  aria-label={isVisible ? "Hide prop on output" : "Show prop on output"}
                  className={cn(
                    "shrink-0 rounded-sm p-1 transition",
                    isVisible
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  title={isVisible ? "Hide on output" : "Show on output"}
                >
                  {isVisible ? (
                    <Eye className="h-3 w-3" strokeWidth={1.8} />
                  ) : (
                    <EyeOff className="h-3 w-3" strokeWidth={1.8} />
                  )}
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Inspector for the selected prop */}
      {selected && selectedView && (
        <div className="max-h-[46%] overflow-y-auto border-t border-border/70 bg-background/30 p-3">
          <div className="mb-2 flex items-center justify-between">
            <input
              type="text"
              aria-label="Prop name"
              defaultValue={selected.name}
              key={selected._id}
              onBlur={(event) =>
                commitPropUpdate(selected._id, {
                  name: event.target.value,
                })
              }
              className="flex-1 rounded-sm border border-border/70 bg-background/40 px-2 py-1 text-[11px] text-foreground focus:border-primary/60 focus:outline-hidden"
            />
            <button
              type="button"
              onClick={() => handleDeleteProp(selected._id)}
              disabled={Boolean(pendingAction)}
              className="ml-2 rounded-sm p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
              aria-label="Delete prop"
            >
              {pendingAction === `delete-${selected._id as unknown as string}` ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.6} />
              ) : (
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.6} />
              )}
            </button>
          </div>

          {(selected.kind === "image" || selected.kind === "video") && (
            <label className="mb-2 block text-[10px] text-muted-foreground">
              <span className="mb-1 block">Media</span>
              <select
                value={selectedView.mediaId ?? ""}
                onChange={(event) => {
                  const mediaItem = mediaById.get(event.target.value);
                  if (!mediaItem) return;
                  commitPropUpdate(selected._id, {
                    mediaId: mediaItem.id,
                    name: mediaItem.name.replace(/\.[^.]+$/, "") || mediaItem.name,
                  });
                }}
                className="w-full rounded-sm border border-border/70 bg-background/40 px-2 py-1 text-[11px] text-foreground focus:border-primary/60 focus:outline-hidden"
              >
                <option value="">Select local media</option>
                {mediaItems
                  .filter((item) => item.type === selected.kind)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
          )}

          {selected.kind === "text" && (
            <textarea
              aria-label="Prop text"
              key={`${selected._id}-text`}
              defaultValue={selected.text}
              onBlur={(event) =>
                commitPropUpdate(selected._id, {
                  text: event.target.value,
                })
              }
              className="mb-2 min-h-[44px] w-full resize-y rounded-sm border border-border/70 bg-background/40 px-2 py-1 text-[11px] text-foreground focus:border-primary/60 focus:outline-hidden"
            />
          )}

          {selected.kind === "youtube" && (
            <label className="mb-2 block text-[10px] text-muted-foreground">
              <span className="mb-1 block">YouTube link</span>
              <div className="flex gap-1">
                <input
                  key={`${selected._id}-youtube`}
                  type="url"
                  value={selectedView.youtubeUrl ?? ""}
                  placeholder="https://www.youtube.com/watch?v=..."
                  onChange={(event) =>
                    setPropDraft(selected._id, {
                      youtubeUrl: event.target.value,
                    })
                  }
                  onBlur={(event) =>
                    commitPropUpdate(selected._id, {
                      youtubeUrl: event.target.value.trim(),
                    })
                  }
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.currentTarget.blur();
                  }}
                  className="min-w-0 flex-1 rounded-sm border border-border/70 bg-background/40 px-2 py-1 text-[11px] text-foreground focus:border-primary/60 focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={() =>
                    commitPropUpdate(selected._id, {
                      youtubeUrl: (selectedView.youtubeUrl ?? "").trim(),
                    })
                  }
                  className="rounded-sm border border-border/70 px-2 text-[10px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
                >
                  Save
                </button>
              </div>
            </label>
          )}

          {selected.kind === "ndi" && (
            <label className="mb-2 block text-[10px] text-muted-foreground">
              <span className="mb-1 flex items-center justify-between">
                <span>NDI source</span>
                <button
                  type="button"
                  onClick={() => void loadNdiSources()}
                  className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-[10px] hover:bg-foreground/5 hover:text-foreground"
                >
                  <RefreshCw
                    className={cn("h-3 w-3", isLoadingNdiSources && "animate-spin")}
                    strokeWidth={1.7}
                  />
                  Refresh
                </button>
              </span>
              <select
                value={selectedView.ndiSourceName ?? ""}
                onChange={(event) =>
                  commitPropUpdate(selected._id, {
                    ndiSourceName: event.target.value,
                    name: event.target.value || "NDI source",
                  })
                }
                className="w-full rounded-sm border border-border/70 bg-background/40 px-2 py-1 text-[11px] text-foreground focus:border-primary/60 focus:outline-hidden"
              >
                <option value="">Select an NDI source</option>
                {ndiSources.map((source) => (
                  <option key={source.name} value={source.name}>
                    {source.name}
                  </option>
                ))}
              </select>
              {ndiSources.length === 0 && (
                <span className="mt-1 block text-[9px] text-muted-foreground/80">
                  {isLoadingNdiSources
                    ? "Searching..."
                    : "No NDI sources found on this network yet."}
                </span>
              )}
            </label>
          )}

          {selected.kind === "capture" && (
            <label className="mb-2 block text-[10px] text-muted-foreground">
              <span className="mb-1 flex items-center justify-between">
                <span>HDMI / capture card</span>
                <button
                  type="button"
                  onClick={() => void loadCaptureDevices()}
                  className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-[10px] hover:bg-foreground/5 hover:text-foreground"
                >
                  <RefreshCw
                    className={cn(
                      "h-3 w-3",
                      isLoadingCaptureDevices && "animate-spin",
                    )}
                    strokeWidth={1.7}
                  />
                  Refresh
                </button>
              </span>
              <select
                value={selectedView.captureDeviceId ?? ""}
                onChange={(event) => {
                  const device = captureDevices.find(
                    (item) => item.deviceId === event.target.value,
                  );
                  commitPropUpdate(selected._id, {
                    captureDeviceId: event.target.value,
                    captureDeviceLabel: device?.label ?? "",
                    name: device?.label || "HDMI capture",
                  });
                }}
                className="w-full rounded-sm border border-border/70 bg-background/40 px-2 py-1 text-[11px] text-foreground focus:border-primary/60 focus:outline-hidden"
              >
                <option value="">Select HDMI/camera input</option>
                {captureDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[9px] text-muted-foreground/80">
                {isLoadingCaptureDevices
                  ? "Searching..."
                  : captureDevices.length === 0
                    ? "Connect a USB/Thunderbolt HDMI capture card, then refresh."
                    : "HDMI sources appear as camera/capture devices."}
              </span>
            </label>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Position</span>
              <div className="grid grid-cols-3 gap-0.5">
                {POSITIONS.map((position) => (
                  <button
                    key={position}
                    type="button"
                    onClick={() =>
                      commitPropUpdate(selected._id, { position })
                    }
                    aria-pressed={selectedView.position === position}
                    title={position}
                    className={cn(
                      "h-5 w-5 rounded-sm border text-[8px]",
                      selectedView.position === position
                        ? "border-primary bg-primary/20 text-primary"
                        : "border-border/60 text-muted-foreground hover:border-foreground/40",
                    )}
                  >
                    {position === "full"
                      ? "F"
                      : position
                          .split("-")
                          .map((p) => p[0].toUpperCase())
                          .join("")}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Size {selectedView.sizePercent}%</span>
              <input
                type="range"
                min={5}
                max={100}
                value={selectedView.sizePercent}
                onChange={(event) =>
                  setPropDraft(selected._id, {
                    sizePercent: Number(event.target.value),
                  })
                }
                onPointerUp={(event) =>
                  commitPropUpdate(selected._id, {
                    sizePercent: Number(event.currentTarget.value),
                  })
                }
                onBlur={(event) =>
                  commitPropUpdate(selected._id, {
                    sizePercent: Number(event.currentTarget.value),
                  })
                }
                className="w-32 accent-primary"
              />
            </label>

            <label className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Opacity {Math.round(selectedView.opacity * 100)}%</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={selectedView.opacity}
                onChange={(event) =>
                  setPropDraft(selected._id, {
                    opacity: Number(event.target.value),
                  })
                }
                onPointerUp={(event) =>
                  commitPropUpdate(selected._id, {
                    opacity: Number(event.currentTarget.value),
                  })
                }
                onBlur={(event) =>
                  commitPropUpdate(selected._id, {
                    opacity: Number(event.currentTarget.value),
                  })
                }
                className="w-32 accent-primary"
              />
            </label>

            {selected.kind === "text" && (
              <>
                <label className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Color</span>
                  <input
                    type="color"
                    value={selectedView.color ?? "#ffffff"}
                    onChange={(event) =>
                      setPropDraft(selected._id, {
                        color: event.target.value,
                      })
                    }
                    onBlur={(event) =>
                      commitPropUpdate(selected._id, {
                        color: event.currentTarget.value,
                      })
                    }
                    className="h-5 w-10 rounded-sm border border-border/60 bg-transparent"
                  />
                </label>
                <label className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Font size {selectedView.fontSize ?? 48}px</span>
                  <input
                    type="range"
                    min={16}
                    max={160}
                    value={selectedView.fontSize ?? 48}
                    onChange={(event) =>
                      setPropDraft(selected._id, {
                        fontSize: Number(event.target.value),
                      })
                    }
                    onPointerUp={(event) =>
                      commitPropUpdate(selected._id, {
                        fontSize: Number(event.currentTarget.value),
                      })
                    }
                    onBlur={(event) =>
                      commitPropUpdate(selected._id, {
                        fontSize: Number(event.currentTarget.value),
                      })
                    }
                    className="w-32 accent-primary"
                  />
                </label>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MediaPropThumb({
  item,
  className,
}: {
  item: MediaItem;
  className?: string;
}) {
  if (item.type === "image") {
    return (
      <img
        src={item.url}
        alt=""
        className={cn("object-cover", className)}
        loading="lazy"
      />
    );
  }

  return (
    <span className={cn("relative block overflow-hidden bg-black", className)}>
      <video
        src={item.url}
        aria-label={`${item.name} preview`}
        tabIndex={-1}
        className="h-full w-full object-cover"
        muted
        preload="metadata"
        playsInline
      >
        <track kind="captions" />
      </video>
      <span className="pointer-events-none absolute right-1 top-1 rounded bg-black/70 p-0.5 text-white">
        <Video className="h-3 w-3" strokeWidth={1.8} />
      </span>
    </span>
  );
}
