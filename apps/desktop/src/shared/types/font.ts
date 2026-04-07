export interface SystemFontFace {
  familyName: string;
  postScriptName: string;
  weight: string;
  weightLabel: string;
  style: string;
  styleLabel: string;
  width: string;
  monospace: boolean;
  source: "system";
}

export interface CustomFontFace extends Omit<SystemFontFace, "source"> {
  source: "custom";
  fileName: string;
  filePath: string;
  dataUrl: string;
}

export type FontFaceRecord = SystemFontFace | CustomFontFace;
