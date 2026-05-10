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

export interface PresentationImportProgress {
  phase: "parsing" | "rendering" | "finalizing";
  percent: number | null;
  detail?: string;
}

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
  onProgress?: (progress: PresentationImportProgress) => void,
): Promise<ServicePresentation> {
  if (!file.path || !window.pptxAPI?.parseFile) {
    throw new Error(
      "PPTX import requires native parser support (file path + desktop parser API).",
    );
  }

  onProgress?.({
    phase: "parsing",
    percent: 15,
    detail: "Parsing PowerPoint slides",
  });
  const parsedPresentation = await window.pptxAPI.parseFile(file.path);
  onProgress?.({
    phase: "finalizing",
    percent: 95,
    detail: "Building presentation",
  });
  return convertParsedPptxToPresentation(parsedPresentation);
}

async function importPdfFile(
  file: PresentationImportSource,
  onProgress?: (progress: PresentationImportProgress) => void,
): Promise<ServicePresentation> {
  if (!file.bytes?.length) {
    throw new Error("PDF data was not available for import.");
  }

  onProgress?.({
    phase: "parsing",
    percent: 10,
    detail: "Opening PDF",
  });
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
    onProgress?.({
      phase: "rendering",
      percent: Math.round((pageNumber / pdf.numPages) * 90),
      detail: `Rendering page ${pageNumber} of ${pdf.numPages}`,
    });
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

  onProgress?.({
    phase: "finalizing",
    percent: 95,
    detail: "Building presentation",
  });
  return createServicePresentation(getFileStem(file.name), "pdf", slides);
}

export async function importServicePresentationFile(
  file: PresentationImportSource,
  mode: PresentationImportMode = "presentation",
  onProgress?: (progress: PresentationImportProgress) => void,
): Promise<ServicePresentation> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (extension === "pptx") {
    if (mode === "images") {
      throw new Error(
        "PPTX image mode is disabled. Use normal PPTX import with native canvas renderer.",
      );
    }

    return importPptxFile(file, onProgress);
  }

  if (extension === "pdf") {
    return importPdfFile(file, onProgress);
  }

  throw new Error("Unsupported file type. Import a PDF or PPTX file.");
}
