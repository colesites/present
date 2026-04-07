import type { SlideElement } from "./index";

export interface ParsedPptxSlide {
  id: string;
  title: string;
  backgroundColor: string | null;
  elements: SlideElement[];
  textContent: string;
}

export interface ParsedPptxPresentation {
  title: string;
  slideWidthPx: number;
  slideHeightPx: number;
  slides: ParsedPptxSlide[];
}
