// Lyrics as a library holds them: a "[Verse 1]" line labels the slides
// under it, and a blank line ends a slide.

/** @param {string} body */
export const slidesOf = (body) => {
  const slides = [];
  let label = null;
  for (const block of body.trim().split(/\n\s*\n/)) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const header = lines[0]?.match(/^\[(.+)\]$/);
    if (header) {
      label = header[1];
      lines.shift();
    }
    if (lines.length > 0) slides.push({ label, text: lines.join("\n") });
  }
  return slides;
};
