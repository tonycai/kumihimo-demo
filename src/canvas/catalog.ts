import { NODE_KINDS, type NodeKind } from "@/engine/nodes";
import { t, type MessageKey } from "@/i18n";

/** Drag payload type for node-library items. */
export const DND_MIME = "application/x-kumihimo-node";

/** CV-01 double-click search: every word must appear in the node's name or keywords. */
export function searchKinds(query: string): NodeKind[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return NODE_KINDS.filter((kind) => {
    const haystack = `${t(`node.${kind}`)} ${t(`node.${kind}.keywords` as MessageKey)}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}
