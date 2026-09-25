/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as authUtils from "../authUtils.js";
import type * as billing from "../billing.js";
import type * as categories from "../categories.js";
import type * as debug from "../debug.js";
import type * as entitlements from "../entitlements.js";
import type * as http from "../http.js";
import type * as invites from "../invites.js";
import type * as libraries from "../libraries.js";
import type * as lyrics from "../lyrics.js";
import type * as messages from "../messages.js";
import type * as orgScopes from "../orgScopes.js";
import type * as organizations from "../organizations.js";
import type * as personalCategories from "../personalCategories.js";
import type * as playback from "../playback.js";
import type * as playlists from "../playlists.js";
import type * as props from "../props.js";
import type * as reset from "../reset.js";
import type * as services from "../services.js";
import type * as slideMasters from "../slideMasters.js";
import type * as support from "../support.js";
import type * as themes from "../themes.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  authUtils: typeof authUtils;
  billing: typeof billing;
  categories: typeof categories;
  debug: typeof debug;
  entitlements: typeof entitlements;
  http: typeof http;
  invites: typeof invites;
  libraries: typeof libraries;
  lyrics: typeof lyrics;
  messages: typeof messages;
  orgScopes: typeof orgScopes;
  organizations: typeof organizations;
  personalCategories: typeof personalCategories;
  playback: typeof playback;
  playlists: typeof playlists;
  props: typeof props;
  reset: typeof reset;
  services: typeof services;
  slideMasters: typeof slideMasters;
  support: typeof support;
  themes: typeof themes;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
