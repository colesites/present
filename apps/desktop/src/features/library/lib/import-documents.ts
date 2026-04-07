"use client";

import type { LibrarySlide, ServicePresentation } from "../../../shared/types";
import type { ParsedPptxPresentation } from "../../../shared/types/pptx";
import {
  DEFAULT_CANVAS_SIZE,
  normalizeLibraryContent,
  normalizeLibrarySlide,
} from "./library-items";

export interface PresentationImportSource {
  name: string;
  path?: string;
  bytes?: Uint8Array;
  lastModified?: number;
}

export type PresentationImportMode = "presentation" | "images";

const PPTX_IMPORT_WIDTH = 1920;
const PPTX_IMPORT_HEIGHT = 1080;

function getFileStem(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim() || "Imported presentation";
}

function createServicePresentation(
  title: string,
  sourceType: ServicePresentation["sourceType"],
  slides: LibrarySlide[],
): ServicePresentation {
  const normalizedSlides =
    slides.length > 0
      ? slides.map((slide) => normalizeLibrarySlide(slide, DEFAULT_CANVAS_SIZE))
      : [normalizeLibrarySlide({ text: "", label: "" }, DEFAULT_CANVAS_SIZE)];

  return {
    title,
    sourceType,
    slides: normalizedSlides,
    content: normalizeLibraryContent(
      {
        presentation: {
          canvasSize: DEFAULT_CANVAS_SIZE,
        },
      },
      normalizedSlides,
    ),
  };
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function utf8ToBase64(value: string): string {
  const utf8Bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of utf8Bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function htmlToPlainText(value: string): string {
  if (!value.trim()) {
    return "";
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(value, "text/html");
  return (document.body.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

async function importPptxAsFidelityHtml(
  file: PresentationImportSource,
): Promise<ServicePresentation | null> {
  if (!file.bytes?.length) {
    return null;
  }

  const { pptxToHtml } = await import("@jvmr/pptx-to-html");
  const slidesHtml = await pptxToHtml(bytesToArrayBuffer(file.bytes), {
    width: PPTX_IMPORT_WIDTH,
    height: PPTX_IMPORT_HEIGHT,
    scaleToFit: true,
    letterbox: true,
  });

  if (!slidesHtml.length) {
    return null;
  }

  const slides = slidesHtml.map((slideHtml, index) =>
    normalizeLibrarySlide(
      {
        text: htmlToPlainText(slideHtml) || `Slide ${index + 1}`,
        label: `Slide ${index + 1}`,
        backgroundColor: undefined,
        useBackgroundColor: false,
        elements: [
          {
            id: `pptx_web_${index + 1}`,
            type: "web",
            x: 0,
            y: 0,
            width: PPTX_IMPORT_WIDTH,
            height: PPTX_IMPORT_HEIGHT,
            content: slideHtml,
            isLocked: true,
            style: {
              backgroundColor: "#000000",
              borderRadius: 0,
              opacity: 1,
            },
          },
        ],
      },
      DEFAULT_CANVAS_SIZE,
    ),
  );

  return createServicePresentation(getFileStem(file.name), "pptx", slides);
}

function createSvgForeignObjectMarkup(slideHtml: string): string {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${PPTX_IMPORT_WIDTH}" height="${PPTX_IMPORT_HEIGHT}" viewBox="0 0 ${PPTX_IMPORT_WIDTH} ${PPTX_IMPORT_HEIGHT}">
  <foreignObject x="0" y="0" width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${PPTX_IMPORT_WIDTH}px;height:${PPTX_IMPORT_HEIGHT}px;overflow:hidden;">
      ${slideHtml}
    </div>
  </foreignObject>
</svg>
`.trim();
}

async function svgMarkupToPngDataUrl(svgMarkup: string): Promise<string> {
  const svgDataUrl = `data:image/svg+xml;base64,${utf8ToBase64(svgMarkup)}`;

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = PPTX_IMPORT_WIDTH;
      canvas.height = PPTX_IMPORT_HEIGHT;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Unable to create canvas for PPTX image import."));
        return;
      }

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => {
      reject(new Error("Failed to rasterize PPTX slide to PNG."));
    };
    image.src = svgDataUrl;
  });
}

async function importPptxAsImageSlides(
  file: PresentationImportSource,
): Promise<ServicePresentation | null> {
  if (!file.bytes?.length) {
    return null;
  }

  const { pptxToHtml } = await import("@jvmr/pptx-to-html");
  const slidesHtml = await pptxToHtml(bytesToArrayBuffer(file.bytes), {
    width: PPTX_IMPORT_WIDTH,
    height: PPTX_IMPORT_HEIGHT,
    scaleToFit: true,
    letterbox: true,
  });

  if (!slidesHtml.length) {
    return null;
  }

  const slides: LibrarySlide[] = [];
  for (let index = 0; index < slidesHtml.length; index += 1) {
    const slideHtml = slidesHtml[index];
    const svgMarkup = createSvgForeignObjectMarkup(slideHtml);
    let imageDataUrl = "";

    try {
      imageDataUrl = await svgMarkupToPngDataUrl(svgMarkup);
    } catch {
      imageDataUrl = `data:image/svg+xml;base64,${utf8ToBase64(svgMarkup)}`;
    }

    slides.push(
      normalizeLibrarySlide(
        {
          text: `Slide ${index + 1}`,
          label: `Slide ${index + 1}`,
          elements: [
            {
              id: `pptx_image_${index + 1}`,
              type: "image",
              x: 0,
              y: 0,
              width: PPTX_IMPORT_WIDTH,
              height: PPTX_IMPORT_HEIGHT,
              content: imageDataUrl,
              isLocked: true,
              style: {
                opacity: 1,
                borderRadius: 0,
                objectFit: "fill",
              },
            },
          ],
        },
        DEFAULT_CANVAS_SIZE,
      ),
    );
  }

  return createServicePresentation(getFileStem(file.name), "pptx", slides);
}

function convertParsedPptxToPresentation(
  parsedPresentation: ParsedPptxPresentation,
): ServicePresentation {
  const slides = parsedPresentation.slides.map((slide) =>
    normalizeLibrarySlide(
      {
        text: slide.textContent || slide.title,
        label: slide.title,
        backgroundColor: slide.backgroundColor ?? undefined,
        useBackgroundColor: Boolean(slide.backgroundColor),
        elements: slide.elements,
      },
      DEFAULT_CANVAS_SIZE,
    ),
  );

  return createServicePresentation(parsedPresentation.title, "pptx", slides);
}

async function importPptxFile(
  file: PresentationImportSource,
): Promise<ServicePresentation> {
  try {
    const fidelityPresentation = await importPptxAsFidelityHtml(file);
    if (fidelityPresentation) {
      return fidelityPresentation;
    }
  } catch {
    // Fall back to editable parser pipeline below.
  }

  if (!file.path || !window.pptxAPI?.parseFile) {
    throw new Error(
      "PPTX import is unavailable in this build (fidelity and editable parsers failed).",
    );
  }

  const parsedPresentation = await window.pptxAPI.parseFile(file.path);
  return convertParsedPptxToPresentation(parsedPresentation);
}

async function importPdfFile(
  file: PresentationImportSource,
): Promise<ServicePresentation> {
  if (!file.bytes?.length) {
    throw new Error("PDF data was not available for import.");
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const pdf = await pdfjs.getDocument({
    data: file.bytes,
    useWorkerFetch: false,
  } as Parameters<typeof pdfjs.getDocument>[0]).promise;

  const width = 1920;
  const height = 1080;
  const slides: LibrarySlide[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const pageScale = Math.min(width / baseViewport.width, height / baseViewport.height);
    const renderViewport = page.getViewport({
      scale: Math.max(pageScale, 1),
    });

    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = Math.round(renderViewport.width);
    pageCanvas.height = Math.round(renderViewport.height);

    const pageContext = pageCanvas.getContext("2d");
    if (!pageContext) {
      throw new Error("Unable to render the PDF page.");
    }

    await page.render({
      canvas: pageCanvas,
      canvasContext: pageContext,
      viewport: renderViewport,
    }).promise;

    const slideCanvas = document.createElement("canvas");
    slideCanvas.width = width;
    slideCanvas.height = height;
    const slideContext = slideCanvas.getContext("2d");
    if (!slideContext) {
      throw new Error("Unable to prepare the imported slide.");
    }

    slideContext.fillStyle = "#000000";
    slideContext.fillRect(0, 0, width, height);
    slideContext.drawImage(
      pageCanvas,
      Math.round((width - renderViewport.width) / 2),
      Math.round((height - renderViewport.height) / 2),
      Math.round(renderViewport.width),
      Math.round(renderViewport.height),
    );

    slides.push(
      normalizeLibrarySlide(
        {
          text: `Page ${pageNumber}`,
          label: `Page ${pageNumber}`,
          elements: [
            {
              id: `pdf_page_${pageNumber}_image`,
              type: "image",
              x: 0,
              y: 0,
              width,
              height,
              content: slideCanvas.toDataURL("image/png"),
              style: {
                opacity: 1,
                borderRadius: 0,
                objectFit: "contain",
              },
            },
          ],
        },
        DEFAULT_CANVAS_SIZE,
      ),
    );
  }

  return createServicePresentation(getFileStem(file.name), "pdf", slides);
}

export async function importServicePresentationFile(
  file: PresentationImportSource,
  mode: PresentationImportMode = "presentation",
): Promise<ServicePresentation> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (extension === "pptx") {
    if (mode === "images") {
      try {
        const imagesPresentation = await importPptxAsImageSlides(file);
        if (imagesPresentation) {
          return imagesPresentation;
        }
      } catch {
        throw new Error(
          `Failed to import ${file.name} as image slides. Try normal presentation import.`,
        );
      }
    }

    return importPptxFile(file);
  }

  if (extension === "pdf") {
    return importPdfFile(file);
  }

  throw new Error("Unsupported file type. Import a PDF or PPTX file.");
}
