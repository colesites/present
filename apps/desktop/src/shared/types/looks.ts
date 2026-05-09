export type LookLayerKey =
  | "mask"
  | "messages"
  | "props"
  | "announcements"
  | "presentation"
  | "slide"
  | "media"
  | "videoInput";

export type LookTargetKey = "program" | "stage" | "ndi";

export type LookTextPosition = {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  textAlign: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
};

export type LookTargetState = {
  layers: Record<LookLayerKey, boolean>;
  textPosition: LookTextPosition;
};

export type LookPreset = {
  id: string;
  name: string;
  targets: Record<LookTargetKey, LookTargetState>;
};

export type LooksConfig = {
  version: 2;
  selectedTarget: LookTargetKey;
  selectedLookId: string;
  liveLookId: string;
  looks: LookPreset[];
  updatedAt: number;
};

export const LOOK_LAYER_ORDER: Array<{ key: LookLayerKey; label: string }> = [
  { key: "mask", label: "Mask" },
  { key: "messages", label: "Messages" },
  { key: "props", label: "Props" },
  { key: "announcements", label: "Announcements" },
  { key: "presentation", label: "Presentation" },
  { key: "slide", label: "Slide" },
  { key: "media", label: "Media" },
  { key: "videoInput", label: "Video Input" },
];

export const LOOK_TARGET_ORDER: Array<{ key: LookTargetKey; label: string }> = [
  { key: "program", label: "Screen 1" },
  { key: "stage", label: "Stage" },
  { key: "ndi", label: "NDI" },
];

const defaultTextPosition: LookTextPosition = {
  xPercent: 50,
  yPercent: 50,
  widthPercent: 92,
  heightPercent: 84,
  textAlign: "center",
  verticalAlign: "middle",
};

export const createDefaultLookPreset = (): LookPreset => ({
  id: "default",
  name: "Default",
  targets: {
    program: {
      layers: {
        mask: false,
        messages: false,
        props: true,
        announcements: false,
        presentation: true,
        slide: true,
        media: true,
        videoInput: true,
      },
      textPosition: { ...defaultTextPosition },
    },
    stage: {
      layers: {
        mask: false,
        messages: true,
        props: true,
        announcements: false,
        presentation: true,
        slide: true,
        media: false,
        videoInput: false,
      },
      textPosition: { ...defaultTextPosition, yPercent: 44, heightPercent: 70 },
    },
    ndi: {
      layers: {
        mask: false,
        messages: true,
        props: false,
        announcements: false,
        presentation: true,
        slide: true,
        media: true,
        videoInput: true,
      },
      textPosition: { ...defaultTextPosition },
    },
  },
});

export const createDefaultLooksConfig = (): LooksConfig => ({
  version: 2,
  selectedTarget: "program",
  selectedLookId: "default",
  liveLookId: "default",
  looks: [createDefaultLookPreset()],
  updatedAt: Date.now(),
});
