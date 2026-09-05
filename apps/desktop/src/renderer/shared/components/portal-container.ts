"use client";

import { createContext, useContext } from "react";

/**
 * The element that floating UI (select menus, dropdowns, tooltips) should
 * portal into.
 *
 * Radix portals to `document.body` by default, which is invisible inside a
 * modal `<dialog>`: `showModal()` promotes the dialog into the browser's top
 * layer, and nothing outside that layer can paint above it at any z-index. A
 * dialog therefore publishes its own node here so the menus it contains render
 * inside the top layer with it.
 *
 * `null` means "no dialog ancestor" — consumers fall back to Radix's default.
 */
export const PortalContainerContext = createContext<HTMLElement | null>(null);

export const usePortalContainer = () => useContext(PortalContainerContext);
