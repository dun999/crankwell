"use client";
import { useSyncExternalStore } from "react";

const noop = () => () => {};
/** true after hydration on the client, false during SSR. */
export const useMounted = () => useSyncExternalStore(noop, () => true, () => false);
