import { afterEach, describe, expect, it, vi } from "vitest";
import { createSelectiveStorage } from "@/lib/store/storage";

afterEach(() => vi.unstubAllGlobals());

describe("chat persistence", () => {
  it("skips unchanged history while saving every history change immediately", () => {
    const values = new Map<string, string>();
    const setItem = vi.fn((key: string, value: string) => values.set(key, value));
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem,
      removeItem: (key: string) => values.delete(key),
    });
    const storage = createSelectiveStorage<{ messages: string[]; open: boolean }>()!;
    const messages = ["Hello"];
    storage.setItem("chat", { state: { messages, open: true }, version: 0 });
    // persist calls setItem even for draft/streaming changes excluded by partialize.
    for (let i = 0; i < 50; i++) storage.setItem("chat", { state: { messages, open: true }, version: 0 });
    expect(setItem).toHaveBeenCalledTimes(1);

    storage.setItem("chat", { state: { messages: [...messages, "New token"], open: true }, version: 0 });
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(storage.getItem("chat")).toEqual({ state: { messages: ["Hello", "New token"], open: true }, version: 0 });

    storage.removeItem("chat");
    storage.setItem("chat", { state: { messages, open: true }, version: 0 });
    expect(setItem).toHaveBeenCalledTimes(3);
  });

  it("retries a failed write instead of treating unsaved data as saved", () => {
    const setItem = vi.fn().mockImplementationOnce(() => { throw new Error("storage unavailable"); });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem, removeItem: () => {} });
    const storage = createSelectiveStorage<{ text: string }>()!;
    const value = { state: { text: "Keep this message" }, version: 0 };
    expect(() => storage.setItem("chat", value)).toThrow("storage unavailable");
    storage.setItem("chat", value);
    expect(setItem).toHaveBeenCalledTimes(2);
  });
});
