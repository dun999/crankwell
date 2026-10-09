"use client";

const KEY = "fyc.session";

/** Anonymous per-browser session id; scopes chat history and orders. */
export function getSessionId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}
