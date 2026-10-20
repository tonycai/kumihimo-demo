/**
 * Reads an OpenAI-style chat stream (`data: {...}` events, `data: [DONE]` at the end) and reports
 * each text delta. Aborting the request's signal ends the read.
 */
export async function readChatStream(stream: ReadableStream<Uint8Array>, onDelta: (text: string) => void): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  const handle = (event: string): boolean => {
    for (const line of event.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return true;
      try {
        const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        // ignore keep-alives and partial frames
      }
    }
    return false;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut: number;
      while ((cut = buffer.indexOf("\n\n")) >= 0) {
        const event = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        if (handle(event)) return full;
      }
    }
    if (buffer.trim()) handle(buffer);
    return full;
  } finally {
    reader.releaseLock();
  }
}

/** PF-03: collapse many updates into at most one per animation frame. */
export function frameBatcher(flush: () => void): { schedule(): void; flushNow(): void } {
  let pending = false;
  const raf =
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (cb: () => void) => setTimeout(cb, 16) as unknown as number;
  return {
    schedule() {
      if (pending) return;
      pending = true;
      raf(() => {
        pending = false;
        flush();
      });
    },
    flushNow() {
      pending = false;
      flush();
    },
  };
}
