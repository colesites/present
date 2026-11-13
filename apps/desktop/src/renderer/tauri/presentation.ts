/**
 * The presentation position, from the Rust core.
 *
 * Loaded only under Tauri and only through a dynamic import, so the Electron
 * bundle never sees `@tauri-apps/api`.
 *
 * Mirrors `src-tauri/src/services/presentation.rs`. The service half of the
 * position replaces the `present-service-state` localStorage key; the slide
 * half replaces the `selected` state in `PresentContainer.tsx`.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { safelyUnlisten } from "./electron-bridge";

/** `PRESENTATION_CHANGED_EVENT`. */
export const PRESENTATION_CHANGED = "presentation:changed";

export type ServicePosition = {
  selectedServiceId: string | null;
  isInsideService: boolean;
  serviceItemIndex: number | null;
  selectedServiceGroupId: string | null;
};

export type PresentationPosition = {
  service: ServicePosition;
  deck: { libraryId: string | null; slideCount: number; skipped?: number[] };
  /** The slide on screen. `null` means nothing selected, not slide zero. */
  slideIndex: number | null;
  /** How far through its builds the slide on screen is; past them, all built. */
  buildStep?: number;
  clickSteps?: number;
};

export const getPresentationPosition = (): Promise<PresentationPosition> =>
  invoke("get_presentation_position");

export const setService = (
  serviceId: string | null,
  isInside: boolean,
): Promise<PresentationPosition> =>
  invoke("set_presentation_service", { serviceId, isInside });

export const setServiceItem = (index: number | null): Promise<PresentationPosition> =>
  invoke("set_presentation_service_item", { index });

export const setServiceGroup = (groupId: string | null): Promise<PresentationPosition> =>
  invoke("set_presentation_service_group", { groupId });

/**
 * Deck updates, one at a time and in order. Tauri runs async commands
 * concurrently, so two quick changes of slide could reach the core the wrong
 * way round and leave it on the earlier one.
 */
let deckUpdates: Promise<unknown> = Promise.resolve();

export const setDeck = (
  libraryId: string | null,
  slideCount: number,
  /** Slides "next" and "previous" pass over: the deck's hidden ones. */
  skipped: number[] = [],
  /** How many clicks the slide on screen's builds take. */
  clickSteps = 0,
  /**
   * The slide up (0-based), set in the same change as `clickSteps`, which is
   * its count; `null` leaves the selection as it is. Sent apart, the core
   * announced one slide with the other's count and the two flipped for ever.
   */
  slideIndex: number | null = null,
): Promise<PresentationPosition> => {
  const update = deckUpdates.then(() =>
    invoke<PresentationPosition>("set_presentation_deck", {
      libraryId,
      slideCount,
      skipped,
      clickSteps,
      slideIndex,
    }),
  );
  deckUpdates = update.catch((): undefined => undefined);
  return update;
};

/** 0-based, unlike the AI Operator's tool argument. */
export const goToSlide = (index: number): Promise<PresentationPosition> =>
  invoke("go_to_slide", { index });

export const nextSlide = (): Promise<PresentationPosition> => invoke("next_slide");

export const previousSlide = (): Promise<PresentationPosition> => invoke("previous_slide");

export const reconcileServices = (
  knownServiceIds: string[],
): Promise<PresentationPosition> =>
  invoke("reconcile_presentation_services", { knownServiceIds });

/** Subscribe to position changes. Resolves to an unsubscribe function. */
export const onPresentationChanged = async (
  handler: (position: PresentationPosition) => void,
): Promise<() => void> => {
  const unlisten = await listen<PresentationPosition>(PRESENTATION_CHANGED, (event) =>
    handler(event.payload),
  );

  // Guarded twice over; see `safelyUnlisten`.
  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    safelyUnlisten(unlisten);
  };
};
