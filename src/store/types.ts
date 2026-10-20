/** Graph document types: what React Flow renders and what undo/redo snapshots hold. */

import type { Edge, Node } from "@xyflow/react";

import type { ImageTool } from "@/atlas/models";
import type { NodeKind, PortType } from "@/engine/nodes";

/** Node parameters per kind. Only serialisable values: this is the saved document (TP-02). */
export interface NodeParams {
  textPrompt: { text: string };
  llm: { model: string; systemPrompt: string; temperature: number };
  textToImage: { model: string; size: string; seed: number };
  imageTool: { tool: ImageTool; model: string };
  imageToVideo: { model: string; duration: number; resolution: string | null };
  /** The picked file stays in the browser (execution store); nothing about it is saved in the document. */
  imageUpload: Record<string, never>;
  outputPreview: Record<string, never>;
}

export type KindNode<K extends NodeKind = NodeKind> = Node<NodeParams[K], K>;
export type WorkNode = { [K in NodeKind]: KindNode<K> }[NodeKind];
export type GroupNode = Node<{ label: string }, "group">;
export type KNode = WorkNode | GroupNode;

export type KEdge = Edge<{ portType: PortType }>;

export interface GraphSnapshot {
  nodes: KNode[];
  edges: KEdge[];
}
