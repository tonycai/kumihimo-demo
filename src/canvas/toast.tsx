"use client";

import { useEffect } from "react";
import { createStore, useStore } from "zustand";

const TOAST_MS = 2_500;

const toastStore = createStore<{ text: string | null; seq: number }>()(() => ({ text: null, seq: 0 }));

export function showToast(text: string) {
  toastStore.setState((s) => ({ text, seq: s.seq + 1 }));
}

export function Toast() {
  const { text, seq } = useStore(toastStore);
  useEffect(() => {
    if (!text) return;
    const timer = setTimeout(() => toastStore.setState({ text: null }), TOAST_MS);
    return () => clearTimeout(timer);
  }, [text, seq]);
  if (!text) return null;
  return (
    <div
      role="status"
      className="pointer-events-none absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-md bg-zinc-900 px-3 py-2 text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
    >
      {text}
    </div>
  );
}
