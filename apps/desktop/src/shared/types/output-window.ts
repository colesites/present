export type VideoSettings = {
  loop: boolean;
  muted: boolean;
};

export type LibraryStyle = {
  fontFamily: string;
  fontSize: number;
  fontBold: boolean;
  fontItalic: boolean;
  fontUnderline: boolean;
};

// State matching what useOutputBroadcast sends
export type OutputState = {
  mediaUrl: string | null;
  mediaType: "image" | "video" | null;
  mediaId: string | null;
  showText: boolean;
  showMedia: boolean;
  videoSettings: VideoSettings;
  mediaFilterCSS: string;
  isVideoPlaying: boolean;
  videoCurrentTime: number;
  shouldSyncTime: boolean;

  // Text details
  activeSlideId: string | null;
  slideText: string | null;
  slideFooter: string | null;
  timerLabel?: string | null;
  timerText?: string | null;
  timerRunning?: boolean;
  timerVisible?: boolean;

  scriptureStyle: {
    fontSize: number;
    fontFamily: string;
    textAlign: "left" | "center" | "right";
  };
  libraryStyle: LibraryStyle;
  timerLayout?: {
    xPercent: number;
    yPercent: number;
    clockFontPx: number;
    nameFontPx: number;
    clockColor: string;
    nameColor: string;
    nameBannerEnabled: boolean;
    nameBannerColor: string;
    titlePosition: "top" | "bottom";
  };
};
