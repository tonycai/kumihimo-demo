import type { NodeTypes } from "@xyflow/react";

import {
  GroupNode,
  ImageToolNode,
  ImageToVideoNode,
  ImageUploadNode,
  LlmNode,
  OutputPreviewNode,
  TextPromptNode,
  TextToImageNode,
} from "./nodes/WorkNodes";

/** Defined once at module level so React Flow never sees a new object. */
export const nodeTypes = {
  textPrompt: TextPromptNode,
  llm: LlmNode,
  textToImage: TextToImageNode,
  imageTool: ImageToolNode,
  imageToVideo: ImageToVideoNode,
  imageUpload: ImageUploadNode,
  outputPreview: OutputPreviewNode,
  group: GroupNode,
} satisfies NodeTypes;
