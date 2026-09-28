import type {
  ScriptureFooterPosition,
  ScriptureTextAlign,
  ScriptureVerticalAlign,
} from "../../../shared/types/output-window";

export type Settings = {
  scriptureSpeechLang: string;
  speechInputDeviceId?: string | null;
  audioOutputDeviceId?: string | null;
  audioOutputDeviceLabel?: string | null;
  scriptureBackgroundMediaId?: string | null;
  scriptureFontSize: number;
  scriptureFooterFontSize: number;
  scriptureFontFamily: string;
  scriptureFontWeight: string;
  scriptureTextAlign: ScriptureTextAlign;
  scriptureVerticalAlign: ScriptureVerticalAlign;
  scriptureFooterAlign: ScriptureTextAlign;
  scriptureFooterPosition: ScriptureFooterPosition;
  libraryFontSize: number;
  libraryFontFamily: string;
  libraryFontWeight: string;
  timerXPercent: number;
  timerYPercent: number;
  timerClockFontPx: number;
  timerNameFontPx: number;
  timerNameBannerHeightPx: number;
  timerClockColor: string;
  timerNameColor: string;
  timerNameBannerEnabled: boolean;
  timerNameBannerColor: string;
  timerTitlePosition: "top" | "bottom";
  /** Behind the clock: a colour, or "" for nothing. */
  timerBoxColor?: string;
  /** What shows once the live timer runs out (`TimeUpSettings`). */
  timerTimeUp?: {
    enabled?: boolean;
    text?: string;
    color?: string;
    blink?: boolean;
  };
  outputDisplayId?: number | null;
  screenDisplayIds?: {
    audience?: number | null;
    media?: number | null;
    worship?: number | null;
  };
  screenResolutions?: {
    audience?: string | null;
    media?: string | null;
    worship?: string | null;
  };
  ndiEnabled?: boolean;
  ndiSourceName?: string;
  ndiGroupName?: string;
  /** What the stream declares and is paced to: 24, 25, 30, 50 or 60. */
  ndiFrameRate?: number;
  agent?: Partial<AgentSettings>;
};

/**
 * How the Bible and song agents behave while they listen. The defaults are
 * what each did before it could be changed.
 */
export type AgentSettings = {
  /** A passage the Bible agent hears goes on screen, or waits in the Bible tab. */
  bibleOnHeard: "show" | "find";
  /** A passage it hears is added to the open service. */
  bibleAddToService: boolean;
  /** "Next verse" and "previous verse" move the passage on screen. */
  bibleVoiceCommands: boolean;
  /** The song agent moves the song on screen along as it is sung. */
  songFollow: boolean;
  /** It says when the band is singing another song from the library. */
  songSuggest: boolean;
};

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  bibleOnHeard: "show",
  bibleAddToService: true,
  bibleVoiceCommands: true,
  songFollow: true,
  songSuggest: true,
};

/** Agent settings from storage, with anything missing or wrong as the default. */
export function normalizeAgentSettings(value: unknown): AgentSettings {
  const stored = (value && typeof value === "object" ? value : {}) as Partial<
    Record<keyof AgentSettings, unknown>
  >;
  const flag = (key: keyof AgentSettings, fallback: boolean) =>
    typeof stored[key] === "boolean" ? (stored[key] as boolean) : fallback;
  return {
    bibleOnHeard: stored.bibleOnHeard === "find" ? "find" : "show",
    bibleAddToService: flag("bibleAddToService", DEFAULT_AGENT_SETTINGS.bibleAddToService),
    bibleVoiceCommands: flag("bibleVoiceCommands", DEFAULT_AGENT_SETTINGS.bibleVoiceCommands),
    songFollow: flag("songFollow", DEFAULT_AGENT_SETTINGS.songFollow),
    songSuggest: flag("songSuggest", DEFAULT_AGENT_SETTINGS.songSuggest),
  };
}

export const SETTINGS_STORAGE_KEY = "present-settings";

export const SETTINGS_LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "en-AU", label: "English (Australia)" },
  { value: "en-CA", label: "English (Canada)" },
  { value: "en-IE", label: "English (Ireland)" },
  { value: "en-IN", label: "English (India)" },
  { value: "en-NG", label: "English (Nigeria)" },
  { value: "en-NZ", label: "English (New Zealand)" },
  { value: "en-PH", label: "English (Philippines)" },
  { value: "en-ZA", label: "English (South Africa)" },
];
