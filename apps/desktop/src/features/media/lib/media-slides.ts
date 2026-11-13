"use client";

/**
 * The Media panel's Slides: the PowerPoints and PDFs kept in a media folder.
 *
 * The document stays in its folder, as an image or a video does. What the
 * importer makes of it — the same `importServicePresentationFile` File ▸
 * Import uses — is kept once in Rust (`services/media_slides.rs`), named by
 * the document's content, and read here into memory. A service that uses the
 * deck keeps only a `MediaSlidesReference`; `resolveServicePresentation` puts
 * the slides back when the service is shown. No service holds a copy.
 */

import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

import type {
  MediaSlidesReference,
  ServicePresentation,
} from "../../../shared/types";
import {
  importServicePresentationFile,
  type PresentationImportProgress,
} from "../../library/lib/import-documents";
import { decodeBase64 } from "../../../renderer/tauri/electron-bridge";

export const SLIDES_EXTENSIONS = [".pptx", ".pdf"];

export const isSlidesDocument = (fileName: string) => {
  const lower = fileName.toLowerCase();
  return SLIDES_EXTENSIONS.some((extension) => lower.endsWith(extension));
};

export const slidesSourceType = (fileName: string): ServicePresentation["sourceType"] =>
  fileName.toLowerCase().endsWith(".pdf") ? "pdf" : "pptx";

const decks = new Map<string, ServicePresentation>();
/** Decks being read or converted, so two asks share one. */
const pending = new Map<string, Promise<ServicePresentation | null>>();
/** A document's id by its path and modification time: hashing is not free. */
const ids = new Map<string, Promise<string>>();
/** Decks asked for that are not kept: their document has not been converted. */
const missing = new Set<string>();

let version = 0;
const listeners = new Set<() => void>();
const announce = () => {
  version += 1;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Changes whenever a deck arrives, so what shows decks draws again. */
export const useMediaSlidesVersion = () =>
  useSyncExternalStore(subscribe, () => version, () => version);

export const deckIdFor = (path: string, lastModified: number) => {
  const key = `${path}\u0000${lastModified}`;
  let id = ids.get(key);
  if (!id) {
    id = invoke<string>("media_slides_id", { path });
    id.catch(() => ids.delete(key));
    ids.set(key, id);
  }
  return id;
};

/** The deck kept for `deckId`, if it is in memory already. */
export const getLoadedDeck = (deckId: string) => decks.get(deckId) ?? null;

/** The deck kept for `deckId`, read from disk if need be; `null` when none is kept. */
export const loadDeck = (deckId: string): Promise<ServicePresentation | null> => {
  const loaded = decks.get(deckId);
  if (loaded) return Promise.resolve(loaded);
  let reading = pending.get(deckId);
  if (!reading) {
    reading = invoke<ServicePresentation | null>("read_media_slides", { id: deckId })
      .then((deck) => {
        if (deck && Array.isArray(deck.slides)) {
          decks.set(deckId, deck);
          missing.delete(deckId);
        } else {
          missing.add(deckId);
        }
        announce();
        return deck ?? null;
      })
      .finally(() => pending.delete(deckId));
    pending.set(deckId, reading);
  }
  return reading;
};

/**
 * Conversions, one at a time. A folder of decks dropped in at once would
 * otherwise parse every PowerPoint and draw every PDF page together.
 */
let conversions: Promise<unknown> = Promise.resolve();
const oneAtATime = <T,>(task: () => Promise<T>): Promise<T> => {
  const run = conversions.then(task, task);
  conversions = run.catch((): undefined => undefined);
  return run;
};

export type MediaSlidesDocument = {
  name: string;
  path: string;
  lastModified: number;
};

/**
 * The slides of `document`: the kept deck, or the document converted now by
 * the importer File ▸ Import uses and kept. Returns its id with it.
 */
export const prepareMediaSlides = async (
  document: MediaSlidesDocument,
  onProgress?: (progress: PresentationImportProgress) => void,
): Promise<{ deckId: string; deck: ServicePresentation }> => {
  const deckId = await deckIdFor(document.path, document.lastModified);
  const kept = await loadDeck(deckId).catch((): null => null);
  if (kept) return { deckId, deck: kept };

  let converting = pending.get(deckId);
  if (!converting) {
    converting = oneAtATime(async () => {
      const isPdf = slidesSourceType(document.name) === "pdf";
      // The PDF reader needs the bytes; the PowerPoint one reads the path.
      const bytes = isPdf
        ? decodeBase64(
            (await invoke<{ bytes: string }>("read_media_presentation", { path: document.path }))
              .bytes,
          )
        : undefined;
      const converted = await importServicePresentationFile(
        { name: document.name, path: document.path, bytes, lastModified: document.lastModified },
        "presentation",
        onProgress,
      );
      const deck: ServicePresentation = { ...converted, media: undefined };
      await invoke("write_media_slides", { id: deckId, deck });
      decks.set(deckId, deck);
      missing.delete(deckId);
      announce();
      return deck;
    }).finally(() => pending.delete(deckId));
    pending.set(deckId, converting);
  }
  const deck = await converting;
  if (!deck) throw new Error("The slides could not be prepared.");
  return { deckId, deck };
};

/** The reference a service keeps to `slideIndices` of a Media deck — all when absent. */
export const createMediaSlidesPresentation = (
  title: string,
  sourceType: ServicePresentation["sourceType"],
  reference: MediaSlidesReference,
): ServicePresentation => ({
  title,
  sourceType,
  slides: [],
  media: reference,
});

const pickSlides = (deck: ServicePresentation, reference: MediaSlidesReference) =>
  reference.slideIndices
    ? reference.slideIndices
        .map((index) => deck.slides[index])
        .filter((slide): slide is ServicePresentation["slides"][number] => Boolean(slide))
    : deck.slides;

/**
 * A service's presentation as it is shown: a Media deck's slides read from the
 * shared copy, any other as it is stored. A deck not read yet is read, and
 * `useMediaSlidesVersion` changes when it arrives.
 */
export const resolveServicePresentation = (
  presentation: ServicePresentation,
): ServicePresentation => {
  const reference = presentation.media;
  if (!reference) return presentation;
  const deck = decks.get(reference.deckId);
  if (!deck) {
    if (!missing.has(reference.deckId)) void loadDeck(reference.deckId).catch((): undefined => undefined);
    return presentation;
  }
  return {
    ...presentation,
    content: presentation.content ?? deck.content,
    slides: pickSlides(deck, reference),
  };
};

/**
 * What a service stores after `presentation` was edited there. Unchanged
 * slides keep the reference and no copy; edited ones become the service's own
 * and the reference is let go, so the edit reaches no other service.
 */
export const toStoredServicePresentation = (
  presentation: ServicePresentation,
): ServicePresentation => {
  const reference = presentation.media;
  if (!reference) return presentation;
  const deck = decks.get(reference.deckId);
  const shared = deck ? pickSlides(deck, reference) : null;
  if (shared && JSON.stringify(shared) === JSON.stringify(presentation.slides)) {
    return { ...presentation, slides: [] };
  }
  if (!deck && presentation.slides.length === 0) return presentation;
  return { ...presentation, content: presentation.content ?? deck?.content, media: undefined };
};
