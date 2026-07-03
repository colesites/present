"use client";

import { ConvexHttpClient } from "convex/browser";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";
import { ensureFreshDesktopAccessToken } from "../store/desktopSession";

const DEFAULT_DESKTOP_CONVEX_URL = "https://wary-iguana-735.convex.cloud";
const convexUrl = process.env.CONVEX_URL ?? DEFAULT_DESKTOP_CONVEX_URL;

const isAuthError = (error: unknown) =>
  error instanceof Error && /not authenticated/i.test(error.message);

export async function runAuthenticatedConvexMutation<
  Mutation extends FunctionReference<"mutation">,
>(
  mutation: Mutation,
  args: FunctionArgs<Mutation>,
  primaryOperation: () => Promise<FunctionReturnType<Mutation>>,
): Promise<FunctionReturnType<Mutation>> {
  try {
    return await primaryOperation();
  } catch (error) {
    if (!isAuthError(error)) {
      throw error;
    }

    const token = await ensureFreshDesktopAccessToken({ forceRefresh: true });
    if (!token) {
      throw error;
    }

    const client = new ConvexHttpClient(convexUrl, {
      auth: token,
      logger: false,
    });
    return client.mutation(mutation, args, { skipQueue: true });
  }
}
