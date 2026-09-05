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
};

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
