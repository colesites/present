export type Settings = {
  scriptureSpeechLang: string;
  scriptureBackgroundMediaId?: string | null;
  scriptureFontSize: number;
  scriptureFontFamily: string;
  scriptureTextAlign: "left" | "center" | "right";
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
