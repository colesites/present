"use client";

import type { ComponentType, ReactNode } from "react";
import {
  Clock3,
  Image,
  ImageOff,
  MessageSquare,
  Monitor,
  RadioTower,
  Tv,
  Type,
  Wifi,
} from "lucide-react";
import { cn } from "../../renderer/shared/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../renderer/shared/components/ui/select";

export type StageLayerSettings = {
  showText: boolean;
  showMedia: boolean;
  showTimer: boolean;
  showMessages: boolean;
  hideBackground: boolean;
};

interface StageCardProps {
  title: string;
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
  isLive: boolean;
  accentClassName: string;
  settings: StageLayerSettings;
  onChange: (patch: Partial<StageLayerSettings>) => void;
  children?: ReactNode;
}

interface MediaStagePanelProps {
  displays: Display[];
  outputDisplayId: number | null;
  onOutputDisplayChange: (id: number | null) => void;
  onOpenProgramOutput: () => void;
  onCloseProgramOutput: () => void;
  isProgramOutputLive: boolean;
  programSettings: StageLayerSettings;
  onProgramSettingsChange: (patch: Partial<StageLayerSettings>) => void;
  stageSettings: StageLayerSettings;
  onStageSettingsChange: (patch: Partial<StageLayerSettings>) => void;
  livestreamSettings: StageLayerSettings;
  onLivestreamSettingsChange: (patch: Partial<StageLayerSettings>) => void;
  ndiEnabled: boolean;
  ndiSourceName: string;
  ndiGroupName: string;
}

function LayerToggle({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition",
        active
          ? "border-primary/60 bg-primary/15 text-primary"
          : "border-border bg-background text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function StageCard({
  title,
  subtitle,
  icon: Icon,
  isLive,
  accentClassName,
  settings,
  onChange,
  children,
}: StageCardProps) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card/80 p-4 shadow-sm backdrop-blur-sm",
        accentClassName
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="rounded-md border border-border/70 bg-background/80 p-1.5">
              <Icon className="h-4 w-4 text-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
              <p className="text-[11px] text-muted-foreground">{subtitle}</p>
            </div>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            isLive
              ? "border-emerald-600/30 bg-emerald-600/15 text-emerald-400"
              : "border-border bg-secondary/40 text-muted-foreground"
          )}
        >
          {isLive ? "Live" : "Idle"}
        </span>
      </div>

      {children}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <LayerToggle
          active={settings.showText}
          icon={Type}
          label="Text"
          onClick={() => onChange({ showText: !settings.showText })}
        />
        <LayerToggle
          active={settings.showMedia}
          icon={Image}
          label="Media"
          onClick={() => onChange({ showMedia: !settings.showMedia })}
        />
        <LayerToggle
          active={settings.showTimer}
          icon={Clock3}
          label="Timer"
          onClick={() => onChange({ showTimer: !settings.showTimer })}
        />
        <LayerToggle
          active={settings.showMessages}
          icon={MessageSquare}
          label="Messages"
          onClick={() => onChange({ showMessages: !settings.showMessages })}
        />
        <LayerToggle
          active={settings.hideBackground}
          icon={ImageOff}
          label="No background"
          onClick={() => onChange({ hideBackground: !settings.hideBackground })}
        />
      </div>
    </section>
  );
}

export function MediaStagePanel({
  displays,
  outputDisplayId,
  onOutputDisplayChange,
  onOpenProgramOutput,
  onCloseProgramOutput,
  isProgramOutputLive,
  programSettings,
  onProgramSettingsChange,
  stageSettings,
  onStageSettingsChange,
  livestreamSettings,
  onLivestreamSettingsChange,
  ndiEnabled,
  ndiSourceName,
  ndiGroupName,
}: MediaStagePanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="shrink-0 border-b border-border bg-card px-4 py-3">
        <h2 className="text-sm font-semibold">Media Stage</h2>
        <p className="text-[11px] text-muted-foreground">
          Route layers to Program, Stage, and Livestream destinations.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <StageCard
          title="Program Output"
          subtitle="TV / projector feed"
          icon={Monitor}
          isLive={isProgramOutputLive}
          accentClassName="bg-gradient-to-br from-card via-card to-primary/5"
          settings={programSettings}
          onChange={onProgramSettingsChange}
        >
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
            <Select
              value={outputDisplayId === null ? "auto" : String(outputDisplayId)}
              onValueChange={(value) => {
                onOutputDisplayChange(
                  value === "auto" ? null : Number.parseInt(value, 10)
                );
              }}
            >
              <SelectTrigger className="h-8 rounded-md border border-border bg-background/80 px-3 text-[11px]">
                <SelectValue placeholder="Select display" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (largest external)</SelectItem>
                {displays.map((display) => (
                  <SelectItem key={display.id} value={String(display.id)}>
                    {display.isPrimary
                      ? `Primary (${display.bounds.width}x${display.bounds.height})`
                      : `${display.label?.trim() || `Display ${display.id}`} (${display.bounds.width}x${display.bounds.height})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <button
              type="button"
              onClick={onOpenProgramOutput}
              className="inline-flex h-8 items-center justify-center rounded-md border border-emerald-600/35 bg-emerald-600/15 px-3 text-[11px] font-semibold text-emerald-400 transition hover:bg-emerald-600/25"
            >
              Project
            </button>
            <button
              type="button"
              onClick={onCloseProgramOutput}
              className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-[11px] font-semibold text-muted-foreground transition hover:text-foreground"
            >
              Close
            </button>
          </div>
        </StageCard>

        <StageCard
          title="Stage Monitor"
          subtitle="Band / speaker confidence feed"
          icon={Tv}
          isLive={stageSettings.showText || stageSettings.showTimer}
          accentClassName="bg-gradient-to-br from-card via-card to-sky-500/5"
          settings={stageSettings}
          onChange={onStageSettingsChange}
        />

        <StageCard
          title="Livestream"
          subtitle="OBS / broadcast destination"
          icon={RadioTower}
          isLive={ndiEnabled}
          accentClassName="bg-gradient-to-br from-card via-card to-violet-500/5"
          settings={livestreamSettings}
          onChange={onLivestreamSettingsChange}
        >
          <div className="grid gap-2 rounded-md border border-border bg-background/70 p-2 text-[11px] text-muted-foreground md:grid-cols-3">
            <div>
              <span className="block uppercase tracking-wide text-[10px]">
                Transport
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 font-medium",
                  ndiEnabled ? "text-emerald-400" : "text-muted-foreground"
                )}
              >
                <Wifi className="h-3.5 w-3.5" />
                {ndiEnabled ? "NDI Enabled" : "NDI Disabled"}
              </span>
            </div>
            <div>
              <span className="block uppercase tracking-wide text-[10px]">
                Source
              </span>
              <span className="truncate font-medium text-foreground">
                {ndiSourceName || "Present Main Output"}
              </span>
            </div>
            <div>
              <span className="block uppercase tracking-wide text-[10px]">
                Group
              </span>
              <span className="truncate font-medium text-foreground">
                {ndiGroupName || "Public"}
              </span>
            </div>
          </div>
        </StageCard>
      </div>
    </div>
  );
}
