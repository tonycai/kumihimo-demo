/**
 * Workflow JSON export and import (TP-02, AT-07). The file holds the graph only: nodes, edges,
 * parameters and groups. Results, uploads and their URLs live in the execution store and are never
 * written (AT-07). Import is data only: JSON.parse, then a strict schema; unknown fields are
 * dropped, models must be in the registry, and nothing in the file is ever evaluated.
 */

import { z } from "zod";

import { availableImageTools, getModel } from "@/atlas/models";
import { MAX_PROMPT_LENGTH } from "@/atlas/validate";
import { checkPorts } from "@/engine/connection";
import { hasCycle } from "@/engine/graph";
import { edgeId, GROUP_TYPE } from "@/engine/layout";
import { isNodeKind, NODE_SPECS, type NodeKind } from "@/engine/nodes";

import type { GraphSnapshot, KEdge, KNode, NodeParams } from "./types";

export const WORKFLOW_SCHEMA = "kumihimo.workflow";
export const WORKFLOW_VERSION = 1;
export const MAX_IMPORT_NODES = 1_000;
export const MAX_IMPORT_EDGES = 5_000;
export const MAX_IMPORT_BYTES = 2_000_000;
const MAX_GROUP_LABEL = 80;

const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/);
const coordinate = z.number().finite().min(-1e6).max(1e6);
const size = z.number().finite().min(1).max(1e5);

const fileNode = z.object({
  id,
  type: z.string().max(32),
  position: z.object({ x: coordinate, y: coordinate }),
  data: z.record(z.string(), z.unknown()),
  parentId: id.optional(),
  width: size.optional(),
  height: size.optional(),
});

const fileEdge = z.object({ source: id, sourceHandle: z.string().max(32), target: id, targetHandle: z.string().max(32) });

const fileSchema = z.object({
  schema: z.literal(WORKFLOW_SCHEMA),
  version: z.literal(WORKFLOW_VERSION),
  nodes: z.array(fileNode).max(MAX_IMPORT_NODES),
  edges: z.array(fileEdge).max(MAX_IMPORT_EDGES),
});

export type WorkflowFile = z.infer<typeof fileSchema>;

/** Parameters per kind, checked against the registry: a model the registry does not list is refused. */
const prompt = z.string().max(MAX_PROMPT_LENGTH);
const PARAMS: { [K in NodeKind]: (data: unknown) => NodeParams[K] | string } = {
  textPrompt: (d) => parseWith(z.object({ text: prompt }), d),
  llm: (d) => {
    const p = parseWith(z.object({ model: z.string(), systemPrompt: prompt, temperature: z.number().finite() }), d);
    if (typeof p === "string") return p;
    const m = getModel(p.model, "llm");
    if (!m) return unknownModel(p.model);
    if (p.temperature < m.temperature.min || p.temperature > m.temperature.max) return "temperature out of range";
    return p;
  },
  textToImage: (d) => {
    const p = parseWith(z.object({ model: z.string(), size: z.string(), seed: z.number().int() }), d);
    if (typeof p === "string") return p;
    const m = getModel(p.model, "textToImage");
    if (!m) return unknownModel(p.model);
    if (!m.sizes.includes(p.size)) return `size "${p.size}" is not offered by ${p.model}`;
    if (p.seed !== -1 && (!m.seed || p.seed < m.seed.min || p.seed > m.seed.max)) return "seed out of range";
    return p;
  },
  imageTool: (d) => {
    const p = parseWith(z.object({ tool: z.enum(["upscale", "removeBackground", "stylize"]), model: z.string() }), d);
    if (typeof p === "string") return p;
    if (!availableImageTools().includes(p.tool)) return `tool "${p.tool}" is not available`;
    const m = getModel(p.model, "imageTool");
    if (!m) return unknownModel(p.model);
    if (m.tool !== p.tool) return `${p.model} is not a ${p.tool} model`;
    return p;
  },
  imageToVideo: (d) => {
    const p = parseWith(
      z.object({ model: z.string(), duration: z.number(), resolution: z.string().nullable() }),
      d,
    );
    if (typeof p === "string") return p;
    const m = getModel(p.model, "imageToVideo");
    if (!m) return unknownModel(p.model);
    if (!m.durations.includes(p.duration)) return `duration ${p.duration} is not offered by ${p.model}`;
    if (p.resolution === null ? m.resolutionField !== null : !m.resolutions.includes(p.resolution)) {
      return `resolution is not offered by ${p.model}`;
    }
    return p;
  },
  imageUpload: (d) => parseWith(z.object({}), d) as NodeParams["imageUpload"] | string,
  outputPreview: (d) => parseWith(z.object({}), d) as NodeParams["outputPreview"] | string,
};

function parseWith<T>(schema: z.ZodType<T>, data: unknown): T | string {
  const r = schema.safeParse(data);
  return r.success ? r.data : (r.error.issues[0]?.message ?? "invalid parameters");
}

function unknownModel(model: string): string {
  return `model "${model.slice(0, 80)}" is not in this demo's model registry`;
}

/** The document as a file: only what rebuilds the graph. */
export function exportWorkflow(graph: GraphSnapshot): WorkflowFile {
  return {
    schema: WORKFLOW_SCHEMA,
    version: WORKFLOW_VERSION,
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: n.type ?? "",
      position: { x: n.position.x, y: n.position.y },
      data: { ...n.data },
      ...(n.parentId ? { parentId: n.parentId } : {}),
      ...(n.type === GROUP_TYPE && n.width !== undefined ? { width: n.width } : {}),
      ...(n.type === GROUP_TYPE && n.height !== undefined ? { height: n.height } : {}),
    })),
    edges: graph.edges.map((e) => ({
      source: e.source,
      sourceHandle: e.sourceHandle ?? "",
      target: e.target,
      targetHandle: e.targetHandle ?? "",
    })),
  };
}

export type ImportResult = { ok: true; graph: GraphSnapshot } | { ok: false; reason: string };

/** Text of a .json file → a graph, or the first reason it was refused. */
export function importWorkflow(text: string): ImportResult {
  if (text.length > MAX_IMPORT_BYTES) return fail(`the file is larger than ${MAX_IMPORT_BYTES / 1_000_000} MB`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail("the file is not valid JSON");
  }
  const head = z.object({ schema: z.unknown(), version: z.unknown(), nodes: z.unknown() }).safeParse(raw);
  if (!head.success || head.data.schema !== WORKFLOW_SCHEMA) return fail("this is not a Kumihimo workflow file");
  if (head.data.version !== WORKFLOW_VERSION) return fail(`unsupported workflow version ${String(head.data.version)}`);
  if (Array.isArray(head.data.nodes) && head.data.nodes.length > MAX_IMPORT_NODES) {
    return fail(`the workflow has more than ${MAX_IMPORT_NODES} nodes`);
  }
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(`invalid workflow at ${issue?.path.join(".") || "root"}: ${issue?.message ?? "unknown"}`);
  }
  const file = parsed.data;

  const nodes: KNode[] = [];
  const kinds = new Map<string, string>();
  for (const n of file.nodes) {
    if (kinds.has(n.id)) return fail(`duplicate node id ${n.id}`);
    if (n.parentId !== undefined && kinds.get(n.parentId) !== GROUP_TYPE) {
      return fail(`node ${n.id} is inside ${n.parentId}, which is not a group listed before it`);
    }
    kinds.set(n.id, n.type);
    const base = { id: n.id, position: n.position, ...(n.parentId ? { parentId: n.parentId, extent: "parent" as const } : {}) };
    if (n.type === GROUP_TYPE) {
      const data = parseWith(z.object({ label: z.string().max(MAX_GROUP_LABEL) }), n.data);
      if (typeof data === "string") return fail(`group ${n.id}: ${data}`);
      if (n.parentId) return fail(`group ${n.id} cannot be inside another group`);
      if (n.width === undefined || n.height === undefined) return fail(`group ${n.id} has no size`);
      nodes.push({ ...base, type: GROUP_TYPE, width: n.width, height: n.height, data });
      continue;
    }
    if (!isNodeKind(n.type)) return fail(`unknown node type "${n.type}"`);
    const data = PARAMS[n.type](n.data);
    if (typeof data === "string") return fail(`node ${n.id} (${n.type}): ${data}`);
    nodes.push({ ...base, type: n.type, data } as KNode);
  }

  const edges: KEdge[] = [];
  const taken = new Set<string>();
  for (const e of file.edges) {
    const sourceKind = kinds.get(e.source);
    const targetKind = kinds.get(e.target);
    if (sourceKind === undefined || targetKind === undefined) return fail("an edge points to a node that is not in the file");
    const verdict = checkPorts({ sourceKind, sourceHandle: e.sourceHandle, targetKind, targetHandle: e.targetHandle });
    if (!verdict.ok) return fail(`edge ${e.source} → ${e.target} does not fit those ports`);
    const edge: KEdge = {
      ...e,
      id: edgeId(e),
      data: { portType: verdict.portType },
      className: `edge-${verdict.portType}`,
    };
    if (taken.has(edge.id)) return fail(`duplicate edge ${e.source} → ${e.target}`);
    const port = NODE_SPECS[targetKind as NodeKind].inputs.find((p) => p.id === e.targetHandle);
    if (!port?.multiple && edges.some((x) => x.target === e.target && x.targetHandle === e.targetHandle)) {
      return fail(`input ${e.targetHandle} of ${e.target} has more than one edge`);
    }
    taken.add(edge.id);
    edges.push(edge);
  }
  if (hasCycle(nodes.map((n) => n.id), edges.map((e) => [e.source, e.target]))) return fail("the workflow has a cycle");
  return { ok: true, graph: { nodes, edges } };
}

function fail(reason: string): ImportResult {
  return { ok: false, reason };
}
