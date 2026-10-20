"use client";
import { useCallback, useSyncExternalStore } from "react";

const noop = () => () => {};
/** true after hydration on the client, false during SSR. */
export const useMounted = () => useSyncExternalStore(noop, () => true, () => false);

export function useMediaQuery(query: string) {
  const subscribe = useCallback((notify: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener("change", notify);
    return () => media.removeEventListener("change", notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}
