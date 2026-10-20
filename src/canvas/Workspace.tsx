"use client";

import "@xyflow/react/dist/style.css";

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type XYPosition,
} from "@xyflow/react";
import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from "react";
import { useStore } from "zustand";

import { fetchMode, restoreDemoOverride, setDemoOverride, signIn, signOut } from "@/client/atlas-client";
import {
  continueInDemoMode,
  resultCache,
  resumeInFlight,
  runAll,
  stopAll,
  watchGraphForStaleness,
} from "@/client/engine";
import { createAutosave, type Autosave } from "@/client/persist";
import { effectiveMode, uiStore, useUi } from "@/client/ui";
import { isNodeKind, type NodeKind } from "@/engine/nodes";
import { isStressNode, STRESS_SIZES } from "@/engine/stress";
import { t } from "@/i18n";
import { executionStore } from "@/store/execution";
import { graphStore, useGraph } from "@/store/graph";
import type { KEdge, KNode } from "@/store/types";
import { graphClient } from "@/workers/graph-client";

import { DND_MIME } from "./catalog";
import { nodeTypes } from "./node-types";
import { NodeLibrary } from "./NodeLibrary";
import { PropertiesPanel } from "./PropertiesPanel";
import { QuickAdd } from "./QuickAdd";
import { FpsMeter } from "./FpsMeter";
import { ExportButton, ImportButton, ResetButton } from "./WorkflowFile";
import { DetailLevel } from "./lod";
import { loadStressGraph } from "./stress";
import { arrangeExample, buildExample, exampleLayoutRequest } from "./template";
import { showToast, Toast } from "./toast";
import { useConnectionGuard } from "./use-connection-guard";
import { useShortcuts, useSpaceHeld } from "./use-shortcuts";

const { onNodesChange, onEdgesChange } = graphStore.getState();

// Dev-only handle for acceptance checks in the browser console (never in a production build).
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  (window as unknown as { __kumihimo: unknown }).__kumihimo = { graphStore, executionStore, uiStore };
}

const PANEL_WIDTH = 320;

const button =
  "whitespace-nowrap rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-40 hover:enabled:bg-zinc-100 dark:border-zinc-600 dark:hover:enabled:bg-zinc-800";

/** Asks the server which mode this browser is in, again after sign-in, sign-out or a demo switch. */
function useServerMode() {
  const version = useUi((s) => s.modeVersion);
  useEffect(() => {
    restoreDemoOverride();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetchMode(controller.signal).then(
      (serverMode) => uiStore.setState({ serverMode }),
      () => {},
    );
    return () => controller.abort();
  }, [version]);
}

function ModeBadge() {
  const server = useUi((s) => s.serverMode);
  const live = useUi((s) => effectiveMode(s) === "live");
  // DP-08: a signed-in visitor sees why live is unavailable instead of a passcode prompt.
  const off = server?.signedIn && server.reason === "live_mode_off";
  const label = !server ? t("mode.loading") : live ? t("mode.live") : off ? t("mode.liveOff") : t("mode.mock");
  return (
    <span
      data-testid="mode-badge"
      title={server ? t(live ? "mode.liveHint" : "mode.mockHint") : undefined}
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        live
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200"
          : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
      }`}
    >
      {label}
    </span>
  );
}

/** DP-01: the passcode is posted once and swapped for an HttpOnly session; nothing is stored here. */
function PasscodeControl() {
  const server = useUi((s) => s.serverMode);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => uiStore.setState((s) => ({ modeVersion: s.modeVersion + 1, sessionEnded: false }));
  if (!server) return null;
  if (server.signedIn) {
    return (
      <button
        type="button"
        className="text-xs text-zinc-500 underline"
        onClick={() => void signOut().finally(() => (setDemoOverride(false), refresh()))}
      >
        {t("passcode.signOut")}
      </button>
    );
  }
  if (server.reason !== "no_session") return null;
  return (
    <div className="relative">
      <button type="button" className={button} onClick={() => setOpen((v) => !v)}>
        {t("passcode.open")}
      </button>
      {open && (
        <form
          className="absolute left-0 top-7 z-30 flex w-72 flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          onSubmit={(e) => {
            e.preventDefault();
            const passcode = String(new FormData(e.currentTarget).get("passcode") ?? "");
            setBusy(true);
            setError(null);
            void signIn(passcode)
              .then(() => {
                setOpen(false);
                setDemoOverride(false);
                refresh();
              })
              .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
              .finally(() => setBusy(false));
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
            {t("passcode.label")}
            <input
              name="passcode"
              type="password"
              autoComplete="off"
              required
              className="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-600"
            />
          </label>
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <p className="text-[11px] text-zinc-500">{t("passcode.hint")}</p>
          <button type="submit" disabled={busy} className="rounded bg-indigo-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">
            {t("passcode.submit")}
          </button>
        </form>
      )}
    </div>
  );
}

function useBusy(): boolean {
  return useStore(executionStore, (s) =>
    Object.values(s.byId).some((e) => e.status === "running" || e.status === "queued"),
  );
}

/** TP-01: lay the example out in the Worker, load it as one undoable step, then fit it in view. */
function useLoadExample() {
  const { fitView } = useReactFlow<KNode, KEdge>();
  return async () => {
    const positions = await graphClient().run({ op: "layout", ...exampleLayoutRequest() });
    const suffix = Date.now().toString(36);
    graphStore.getState().loadDocument(buildExample(arrangeExample(positions), (id) => `${id}-${suffix}`));
    // A small margin keeps the zoom at about 0.75 in a 1440×900 window, the whole example still in view.
    setTimeout(() => void fitView({ padding: 0.02 }), 0);
  };
}

/** Messages from the engine (refused live runs) go to the toast. */
function useNotices() {
  const notice = useUi((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    showToast(notice);
    uiStore.setState({ notice: null });
  }, [notice]);
}

/** PF-07: stress graph picker. Generation and layout happen in the Worker; nodes stream in. */
function StressPicker() {
  const { fitBounds } = useReactFlow<KNode, KEdge>();
  const [loading, setLoading] = useState(false);
  return (
    <select
      aria-label={t("toolbar.stress")}
      className={button}
      value=""
      disabled={loading}
      onChange={(e) => {
        const count = Number(e.target.value);
        if (!count) return;
        setLoading(true);
        const pane = document.querySelector(".react-flow")?.getBoundingClientRect();
        void loadStressGraph(count, pane && pane.height > 0 ? pane.width / pane.height : 16 / 10, (bounds) =>
          fitBounds(bounds, { padding: 0.04 }),
        ).finally(() => setLoading(false));
      }}
    >
      <option value="">{t("toolbar.stress")}</option>
      {STRESS_SIZES.map((n) => (
        <option key={n} value={n}>
          {t("toolbar.stressNodes", { count: n })}
        </option>
      ))}
    </select>
  );
}

function Toolbar() {
  useServerMode();
  useNotices();
  const canUndo = useGraph((s) => s.history.past.length > 0);
  const canRedo = useGraph((s) => s.history.future.length > 0);
  const empty = useGraph((s) => s.nodes.length === 0);
  const stress = useGraph((s) => s.nodes.some((n) => isStressNode(n.id)));
  const busy = useBusy();
  const loadExample = useLoadExample();
  return (
    <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
      <button
        type="button"
        className="rounded bg-indigo-600 px-3 py-0.5 text-xs font-semibold text-white disabled:opacity-40 hover:enabled:bg-indigo-500"
        disabled={empty || stress}
        title={stress ? t("run.stressOnly") : undefined}
        onClick={() => void runAll()}
      >
        {t("toolbar.run")}
      </button>
      <button type="button" className={button} disabled={!busy} onClick={stopAll}>
        {t("toolbar.stop")}
      </button>
      <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
      <button type="button" className={button} onClick={() => void loadExample()}>
        {t("toolbar.loadExample")}
      </button>
      <StressPicker />
      <ImportButton className={button} />
      <ExportButton className={button} />
      <ResetButton className={button} onReset={() => void loadExample()} />
      <button type="button" className={button} disabled={!canUndo} onClick={() => graphStore.getState().undo()}>
        {t("toolbar.undo")}
      </button>
      <button type="button" className={button} disabled={!canRedo} onClick={() => graphStore.getState().redo()}>
        {t("toolbar.redo")}
      </button>
      <ModeBadge />
      <PasscodeControl />
      {/* A debugging entry, not for visitors; production builds leave it out (the page stays, see README). */}
      {process.env.NODE_ENV !== "production" && (
        <Link href="/smoke" className="text-xs text-zinc-500 underline">
          {t("toolbar.smoke")}
        </Link>
      )}
    </div>
  );
}

/** AT-06: Atlas said 402 (or today's budget is spent); DP-01: the session ended. Offer demo mode. */
function LiveBlockedBanner() {
  const blocked = useUi((s) => s.liveBlocked);
  const ended = useUi((s) => s.sessionEnded);
  if (!blocked && !ended) return null;
  return (
    <div role="alert" className="flex items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <span>{t(blocked ? "banner.liveBlocked" : "banner.sessionEnded")}</span>
      <button type="button" className={button} onClick={continueInDemoMode}>
        {t("banner.switch")}
      </button>
    </div>
  );
}

function EmptyState() {
  const empty = useGraph((s) => s.nodes.length === 0);
  const loadExample = useLoadExample();
  if (!empty) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
      <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-xl border border-zinc-200 bg-white/90 px-6 py-5 text-center shadow-sm dark:border-zinc-700 dark:bg-zinc-900/90">
        <button
          type="button"
          className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
          onClick={() => void loadExample()}
        >
          {t("toolbar.loadExample")}
        </button>
        <p className="max-w-56 text-xs text-zinc-500">{t("library.hint")}</p>
      </div>
    </div>
  );
}

/** TP-03 / EX-07: restore the last canvas, resume in-flight predictions, then autosave. */
function usePersistence(autosave: React.RefObject<Autosave | null>) {
  const { setViewport, getViewport, fitView } = useReactFlow<KNode, KEdge>();
  useEffect(() => {
    let cancelled = false;
    let stop = () => {};
    const instance = createAutosave();
    instance
      .load()
      .then((saved) => {
        if (cancelled) return;
        if (saved) {
          graphStore.getState().replaceGraph({ nodes: saved.nodes, edges: saved.edges });
          executionStore.getState().replaceAll(saved.exec);
          for (const [key, value] of saved.cache) resultCache.set(key, value);
          if (saved.viewport) void setViewport(saved.viewport);
          else setTimeout(() => void fitView({ padding: 0.06 }), 0);
        }
        uiStore.setState({ autosave: "ok" });
        stop = instance.start(() => getViewport(), resultCache);
        autosave.current = instance;
      })
      .catch(() => {
        if (!cancelled) uiStore.setState({ autosave: "unavailable" });
      })
      .finally(() => {
        if (cancelled) return;
        // Only after the restore, so restoring does not count as an edit.
        watchGraphForStaleness();
        resumeInFlight();
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [setViewport, getViewport, fitView, autosave]);
}

function AutosaveHint() {
  const state = useUi((s) => s.autosave);
  if (state !== "unavailable") return null;
  return (
    <p className="pointer-events-none absolute bottom-2 left-2 z-[5] rounded bg-zinc-900/80 px-2 py-1 text-[11px] text-white">
      {t("autosave.unavailable")}
    </p>
  );
}

function Canvas() {
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const panelOpen = useGraph((s) => s.nodes.some((n) => n.selected));
  const { screenToFlowPosition, setCenter, getZoom } = useReactFlow<KNode, KEdge>();
  const guard = useConnectionGuard();
  const wrapper = useRef<HTMLDivElement>(null);
  const autosave = useRef<Autosave | null>(null);
  const [quickAdd, setQuickAdd] = useState<{ at: XYPosition; flow: XYPosition } | null>(null);
  const spaceHeld = useSpaceHeld();
  useShortcuts();
  usePersistence(autosave);

  function add(kind: NodeKind, flow: XYPosition) {
    graphStore.getState().addNode(kind, flow);
  }

  function onDrop(e: DragEvent) {
    const kind = e.dataTransfer.getData(DND_MIME);
    if (!isNodeKind(kind)) return;
    e.preventDefault();
    // Screen → flow coordinates, so the drop lands under the pointer at any zoom (CV-01).
    add(kind, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  }

  function onDoubleClick(e: MouseEvent) {
    if (!(e.target as Element).classList.contains("react-flow__pane")) return;
    const box = wrapper.current!.getBoundingClientRect();
    setQuickAdd({
      at: { x: e.clientX - box.left, y: e.clientY - box.top },
      flow: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
    });
  }

  // Keep the minimap and zoom controls clear of the properties overlay.
  const sideMargin = panelOpen ? PANEL_WIDTH + 15 : 15;

  return (
    <div
      ref={wrapper}
      className={`relative min-w-0 flex-1 ${spaceHeld ? "space-pan" : ""}`}
      onDoubleClick={onDoubleClick}
    >
      <DetailLevel>
        <ReactFlow<KNode, KEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={guard.onConnect}
          onConnectStart={guard.onConnectStart}
          onConnectEnd={guard.onConnectEnd}
          isValidConnection={guard.isValidConnection}
          onDrop={onDrop}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onMoveEnd={() => autosave.current?.touch()}
          // Deletion goes through the store (undo history, input focus rules): see useShortcuts.
          deleteKeyCode={null}
          nodesDraggable={!spaceHeld}
          zoomOnDoubleClick={false}
          onlyRenderVisibleElements
          minZoom={0.1}
          colorMode="system"
        >
          <Background gap={20} />
          {/* Bottom left, away from the minimap and from the example's right-hand column. */}
          <Controls position="bottom-left" orientation="horizontal" />
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            style={{ marginRight: sideMargin }}
            onClick={(_, p) => void setCenter(p.x, p.y, { zoom: getZoom(), duration: 200 })}
          />
        </ReactFlow>
      </DetailLevel>
      <EmptyState />
      <AutosaveHint />
      <FpsMeter right={panelOpen ? PANEL_WIDTH + 12 : 12} />
      {quickAdd && (
        <QuickAdd
          at={quickAdd.at}
          onClose={() => setQuickAdd(null)}
          onPick={(kind) => {
            add(kind, quickAdd.flow);
            setQuickAdd(null);
          }}
        />
      )}
      <PropertiesPanel width={PANEL_WIDTH} />
      <Toast />
    </div>
  );
}

/** Workspace: library · canvas (with the properties overlay) · run controls. */
export function Workspace() {
  return (
    <ReactFlowProvider>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <Toolbar />
          <p className="min-w-0 truncate text-[11px] text-zinc-500" title={t("toolbar.shortcuts")}>
            {t("toolbar.shortcuts")}
          </p>
        </div>
        <LiveBlockedBanner />
        <div className="flex min-h-0 flex-1">
          <NodeLibrary />
          <Canvas />
        </div>
      </div>
    </ReactFlowProvider>
  );
}
