/**
 * A column's layout on its screen, as a page draws it.
 *
 * Rust turns a look column's layout (`services/looks.rs`, `LookLayout`) into
 * the boxes a screen draws its layers in (`ScreenLayout` in
 * `services/output.rs`); the compositor draws into them natively and the
 * audience page with these. The Looks window lays columns out with the
 * presets below.
 *
 * @typedef {{ xPercent: number, yPercent: number, widthPercent: number, heightPercent: number }} Box
 */

/** @type {Box} */
export const FULL_BOX = { xPercent: 50, yPercent: 50, widthPercent: 100, heightPercent: 100 };

/** @param {Box | null | undefined} box */
export const isFullBox = (box) =>
  !box ||
  (box.xPercent === 50 && box.yPercent === 50 && box.widthPercent >= 100 && box.heightPercent >= 100);

/**
 * A box as CSS: placed by its top-left corner, as percentages of the screen.
 * @param {Box} box
 */
export const boxStyle = (box) => ({
  left: `${box.xPercent - box.widthPercent / 2}%`,
  top: `${box.yPercent - box.heightPercent / 2}%`,
  width: `${box.widthPercent}%`,
  height: `${box.heightPercent}%`,
});

/**
 * The whole screen scaled evenly into a box and centred there, as a
 * transform on a full-screen layer: how the props go into theirs, as the
 * compositor draws them (`draw_into_box`).
 * @param {Box} box
 */
export const screenIntoBoxTransform = (box) => {
  const scale = Math.min(box.widthPercent, box.heightPercent) / 100;
  const left = box.xPercent - box.widthPercent / 2 + (box.widthPercent - scale * 100) / 2;
  const top = box.yPercent - box.heightPercent / 2 + (box.heightPercent - scale * 100) / 2;
  // Translate percentages are of the layer itself, which is the screen.
  return `translate(${left}%, ${top}%) scale(${scale})`;
};

/**
 * A designed slide's words on their own: its text boxes top to bottom, then
 * left to right, one after another, in the first one's font. How "text only"
 * lays a slide out in its box (`draw_words_of`).
 *
 * @param {Array<{ type: string, x: number, y: number, content?: string, isVisible?: boolean,
 *   textBody?: { paragraphs: Array<{ runs: Array<{ text: string }> }> }, style?: Record<string, unknown> }> | null | undefined} elements
 * @returns {{ text: string, style: Record<string, unknown> } | null}
 */
export const wordsOfSlide = (elements) => {
  if (!Array.isArray(elements)) return null;
  const texts = elements
    .filter((element) => element.type === "text" && element.isVisible !== false)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const words = texts
    .map((element) => {
      const paragraphs = element.textBody?.paragraphs;
      const lines =
        Array.isArray(paragraphs) && paragraphs.length > 0
          ? paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
          : (element.content ?? "").split("\n");
      return lines.join("\n").trim();
    })
    .filter((text) => text.length > 0);
  if (texts.length === 0 || words.length === 0) return null;
  return { text: words.join("\n"), style: texts[0].style ?? {} };
};

/**
 * Ready-made layouts for a column, each a whole layout: picking one replaces
 * what the column had. Boxes are as `LookBox`: centre and size, in percent.
 */
export const LAYOUT_PRESETS = [
  {
    id: "screen",
    label: "As the Screen",
    description: "Everything full screen, where the Screen puts it.",
    layout: {},
  },
  {
    id: "lower-third",
    label: "Lower third",
    description: "The words in a band along the bottom, over the media.",
    layout: {
      words: {
        area: { xPercent: 50, yPercent: 84, widthPercent: 90, heightPercent: 24 },
        textAlign: "center",
        verticalAlign: "middle",
        scalePercent: 70,
        textOnly: true,
        backdrop: "#000000b3",
      },
    },
  },
  {
    id: "upper-third",
    label: "Upper third",
    description: "The words in a band along the top.",
    layout: {
      words: {
        area: { xPercent: 50, yPercent: 16, widthPercent: 90, heightPercent: 24 },
        textAlign: "center",
        verticalAlign: "middle",
        scalePercent: 70,
        textOnly: true,
        backdrop: "#000000b3",
      },
    },
  },
  {
    id: "side-by-side",
    label: "Side by side",
    description: "The media on the left, the words on the right.",
    layout: {
      media: { area: { xPercent: 25, yPercent: 50, widthPercent: 50, heightPercent: 100 }, fill: true },
      words: {
        area: { xPercent: 75, yPercent: 50, widthPercent: 46, heightPercent: 80 },
        textAlign: "left",
        verticalAlign: "middle",
        scalePercent: 80,
        textOnly: true,
      },
    },
  },
  {
    id: "corner-media",
    label: "Media in a corner",
    description: "The words full screen, the media small in the top right.",
    layout: {
      media: { area: { xPercent: 82, yPercent: 18, widthPercent: 30, heightPercent: 30 }, fill: false },
    },
  },
];

/** The box each part of a layout starts from when it is first switched on. */
export const STARTING_PLACEMENTS = {
  words: LAYOUT_PRESETS[1].layout.words,
  media: { area: { xPercent: 50, yPercent: 50, widthPercent: 60, heightPercent: 60 }, fill: false },
  props: { xPercent: 50, yPercent: 50, widthPercent: 60, heightPercent: 60 },
  timer: { xPercent: 88, yPercent: 10, scalePercent: 100 },
  messages: { edge: "asSent", scalePercent: 100 },
};
