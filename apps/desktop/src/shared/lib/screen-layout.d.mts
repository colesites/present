/** Types for `screen-layout.mjs`. */

import type { LookBox, LookLayout } from "./looks-config.mjs";

export declare const FULL_BOX: LookBox;
export declare const isFullBox: (box: LookBox | null | undefined) => boolean;
export declare const boxStyle: (box: LookBox) => {
  left: string;
  top: string;
  width: string;
  height: string;
};
export declare const screenIntoBoxTransform: (box: LookBox) => string;

type WordsSource = {
  type: string;
  x: number;
  y: number;
  content?: string;
  isVisible?: boolean;
  textBody?: { paragraphs: Array<{ runs: Array<{ text: string }> }> };
  style?: object;
};
export declare const wordsOfSlide: <Element extends WordsSource>(
  elements: Element[] | null | undefined,
) => { text: string; style: NonNullable<Element["style"]> } | null;

export type LayoutPreset = {
  id: string;
  label: string;
  description: string;
  layout: LookLayout;
};
export declare const LAYOUT_PRESETS: ReadonlyArray<LayoutPreset>;
export declare const STARTING_PLACEMENTS: Required<LookLayout>;
