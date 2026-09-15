import type { ParsedPptxPresentation } from "../../shared/types/pptx";

export declare const TARGET_SLIDE_WIDTH: 1920;
export declare const TARGET_SLIDE_HEIGHT: 1080;
export declare function convertPayloadToPresentation(
  payload: unknown,
  filePath: string,
): ParsedPptxPresentation;
