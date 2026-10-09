import { createJSONStorage, type PersistStorage, type StorageValue } from "zustand/middleware";
import { shallow } from "zustand/shallow";

/** Keep saves synchronous, but skip serialization when only transient state changed. */
export function createSelectiveStorage<T>(): PersistStorage<T> | undefined {
  const storage = createJSONStorage<T>(() => localStorage);
  if (!storage) return undefined;
  const saved = new Map<string, StorageValue<T>>();
  return {
    getItem: storage.getItem,
    setItem: (name, value) => {
      const previous = saved.get(name);
      if (previous?.version === value.version && shallow(previous?.state, value.state)) return;
      storage.setItem(name, value);
      saved.set(name, value);
    },
    removeItem: (name) => {
      storage.removeItem(name);
      saved.delete(name);
    },
  };
}
