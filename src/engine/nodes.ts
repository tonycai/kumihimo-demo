/**
 * Node kinds and their typed ports. Pure data shared by the canvas, the stores and the
 * Worker. Labels live in i18n; model ids live in `src/atlas/models.ts`.
 */

export type PortType = "text" | "image" | "video";

export const NODE_KINDS = [
  "textPrompt",
  "llm",
  "textToImage",
  "imageTool",
  "imageToVideo",
  "imageUpload",
  "outputPreview",
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export interface InputPort {
  /** React Flow target handle id. */
  id: string;
  accepts: readonly PortType[];
  /** More than one incoming edge allowed (Output Preview). Otherwise a new edge replaces the old one. */
  multiple: boolean;
  optional: boolean;
}

export interface OutputPort {
  /** React Flow source handle id. Fan-out is always allowed (ND-08). */
  id: string;
  type: PortType;
}

export interface NodeSpec {
  inputs: readonly InputPort[];
  outputs: readonly OutputPort[];
  /** Runs in the browser, never calls Atlas (ND-01, ND-07). */
  local: boolean;
}

const input = (type: PortType, optional = false): InputPort => ({
  id: `in:${type}`,
  accepts: [type],
  multiple: false,
  optional,
});
const output = (type: PortType): OutputPort => ({ id: `out:${type}`, type });

export const NODE_SPECS: Readonly<Record<NodeKind, NodeSpec>> = {
  textPrompt: { inputs: [], outputs: [output("text")], local: true },
  llm: { inputs: [input("text")], outputs: [output("text")], local: false },
  textToImage: { inputs: [input("text")], outputs: [output("image")], local: false },
  imageTool: { inputs: [input("image"), input("text", true)], outputs: [output("image")], local: false },
  imageToVideo: { inputs: [input("image"), input("text")], outputs: [output("video")], local: false },
  imageUpload: { inputs: [], outputs: [output("image")], local: false },
  outputPreview: {
    inputs: [{ id: "in:any", accepts: ["text", "image", "video"], multiple: true, optional: false }],
    outputs: [],
    local: true,
  },
};

export function isNodeKind(value: unknown): value is NodeKind {
  return typeof value === "string" && (NODE_KINDS as readonly string[]).includes(value);
}

export function outputPort(kind: NodeKind, handleId: string | null | undefined): OutputPort | undefined {
  const outputs = NODE_SPECS[kind].outputs;
  return handleId == null ? outputs[0] : outputs.find((p) => p.id === handleId);
}

export function inputPort(kind: NodeKind, handleId: string | null | undefined): InputPort | undefined {
  const inputs = NODE_SPECS[kind].inputs;
  return handleId == null ? inputs[0] : inputs.find((p) => p.id === handleId);
}
