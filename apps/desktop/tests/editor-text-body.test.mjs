import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import ts from "typescript";

const load = (path) => {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Script(transpiled.outputText).runInContext(createContext({ module, exports: module.exports }));
  return module.exports;
};

const {
  textBodyToEditableHtml,
  editableToTextBody,
  syncTextBodyWithStyle,
  textBodyPlainText,
} = load("../src/features/editor/lib/text-body.ts");

// The module runs in its own realm: compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));

const decode = (value) =>
  value.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const camel = (name) => name.trim().replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

/** Enough of an HTML parser for what the editor writes, as DOM-like nodes. */
function parse(html) {
  const root = { nodeType: 1, nodeName: "DIV", textContent: null, childNodes: [], getAttribute: () => null };
  const stack = [root];
  const pattern = /<(\/?)([a-zA-Z0-9]+)((?:\s+[a-zA-Z-]+="[^"]*")*)\s*>|([^<]+)/g;
  let match;
  while ((match = pattern.exec(html))) {
    const [, closing, tag, attributeText, text] = match;
    const parent = stack[stack.length - 1];
    if (text !== undefined) {
      parent.childNodes.push({ nodeType: 3, nodeName: "#text", textContent: decode(text), childNodes: [] });
      continue;
    }
    if (closing) {
      stack.pop();
      continue;
    }
    const attributes = {};
    for (const [, key, value] of attributeText.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
      attributes[key] = decode(value);
    }
    const style = {};
    for (const declaration of (attributes.style ?? "").split(";")) {
      const at = declaration.indexOf(":");
      if (at > 0) style[camel(declaration.slice(0, at))] = declaration.slice(at + 1).trim();
    }
    const node = {
      nodeType: 1,
      nodeName: tag.toUpperCase(),
      textContent: null,
      childNodes: [],
      style,
      getAttribute: (name) => attributes[name] ?? null,
    };
    parent.childNodes.push(node);
    if (tag.toLowerCase() !== "br") stack.push(node);
  }
  return root;
}

const deck = () => ({
  insetLeft: 10,
  verticalAlign: "top",
  paragraphs: [
    {
      alignment: "left",
      marginLeft: 40,
      indent: -30,
      bullet: { text: "\u2022", fontFamily: "Arial" },
      runs: [
        { text: "Grace ", fontFamily: "Calibri", fontSize: 40, color: "#112233" },
        { text: "and peace", fontFamily: "Calibri", fontSize: 40, fontWeight: "700", color: "#112233" },
      ],
    },
    { alignment: "left", runs: [{ text: "", fontFamily: "Calibri", fontSize: 20 }] },
    {
      alignment: "center",
      lineHeight: 1.5,
      runs: [{ text: "line one\nline two", fontSize: 20, underline: true }],
    },
  ],
});

test("a deck's text box comes back unchanged when nothing was edited", () => {
  const body = deck();
  assert.deepEqual(plain(editableToTextBody(parse(textBodyToEditableHtml(body)), body)), body);
});

test("typed words replace a run's text and keep its look", () => {
  const body = deck();
  const root = parse(textBodyToEditableHtml(body));
  root.childNodes[0].childNodes[0].childNodes[0].textContent = "Mercy ";
  const edited = editableToTextBody(root, body);
  assert.equal(edited.paragraphs[0].runs[0].text, "Mercy ");
  assert.equal(edited.paragraphs[0].runs[0].color, "#112233");
  assert.equal(edited.paragraphs[0].bullet.text, "\u2022");
  assert.equal(textBodyPlainText(edited), "Mercy and peace\n\nline one\nline two");
});

test("bold the browser wraps around a run is kept", () => {
  const body = deck();
  const root = parse(textBodyToEditableHtml(body).replace(/(<span[^>]*>Grace <\/span>)/, "<b>$1</b>"));
  const edited = editableToTextBody(root, body);
  assert.equal(edited.paragraphs[0].runs.length, 1, "now one bold run");
  assert.equal(edited.paragraphs[0].runs[0].text, "Grace and peace");
  assert.equal(edited.paragraphs[0].runs[0].fontWeight, "700");
});

test("a new paragraph from Enter takes the paragraph's format and first run's look", () => {
  const body = deck();
  const html = textBodyToEditableHtml(body);
  const firstDiv = html.match(/^<div[^>]*>/)[0];
  const root = parse(`${html}${firstDiv}Amen</div>`);
  const edited = editableToTextBody(root, body);
  const added = edited.paragraphs[3];
  assert.equal(added.marginLeft, 40);
  assert.equal(added.bullet.text, "\u2022");
  assert.deepEqual(plain(added.runs), [{ text: "Amen", fontFamily: "Calibri", fontSize: 40, color: "#112233" }]);
});

test("removing a run's underline in the browser removes it", () => {
  const body = deck();
  const root = parse(textBodyToEditableHtml(body).replace("text-decoration: underline", "font-style: normal"));
  const edited = editableToTextBody(root, body);
  assert.equal(edited.paragraphs[2].runs[0].underline, false);
});

test("an inspector change reaches every run and paragraph", () => {
  const body = deck();
  const before = { id: "t", type: "text", x: 0, y: 0, width: 10, height: 10, content: "", textBody: body, style: { fontSize: 40, color: "#112233", textAlign: "left" } };
  const after = syncTextBodyWithStyle(before, {
    ...before,
    style: { fontSize: 60, color: "#ff0000", textAlign: "right", verticalAlign: "bottom" },
  });
  assert.deepEqual(
    plain(after.textBody.paragraphs).flatMap((paragraph) => paragraph.runs.map((run) => run.fontSize)),
    [60, 60, 30, 30],
    "sizes scale together",
  );
  assert.ok(after.textBody.paragraphs.every((paragraph) => paragraph.alignment === "right"));
  assert.ok(after.textBody.paragraphs.every((paragraph) => paragraph.runs.every((run) => run.color === "#ff0000")));
  assert.equal(after.textBody.verticalAlign, "bottom");
  assert.equal(body.paragraphs[0].runs[0].fontSize, 40, "the old box is not changed");
});

test("a new text body from an edit is not overwritten by the style", () => {
  const body = deck();
  const before = { id: "t", type: "text", content: "", textBody: body, style: { fontSize: 40 } };
  const replaced = { ...before, textBody: { ...body, paragraphs: [] }, style: { fontSize: 50 } };
  assert.equal(syncTextBodyWithStyle(before, replaced), replaced);
});
