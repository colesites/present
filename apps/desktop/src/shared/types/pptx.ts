import type { SlideElement, SlideTransition } from "./index";

export interface ParsedPptxSlide {
  id: string;
  title: string;
  backgroundColor: string | null;
  elements: SlideElement[];
  textContent: string;
  transition?: SlideTransition | null;
  advanceAfterMs?: number | null;
  hidden?: boolean;
  notes?: string | null;
}

export interface ParsedPptxPresentation {
  title: string;
  slideWidthPx: number;
  slideHeightPx: number;
  slides: ParsedPptxSlide[];
}
