"use client";

import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";

export interface PaneConfig {
  id: string;
  defaultWidth: number;
  minWidth: number;
  content: ReactNode;
  flex?: boolean; // If true, this pane takes remaining space (ignore defaultWidth)
}

interface ResizablePanesProps {
  panes: PaneConfig[];
  storageKey: string;
  collapsedPanes?: Set<string>;
}

interface DragState {
  handleIndex: number; // index of the left pane of the handle
  startX: number;
  startWidths: Map<string, number>;
}

export function ResizablePanes({
  panes,
  storageKey,
  collapsedPanes = new Set(),
}: ResizablePanesProps) {
  // Initialize widths from localStorage or defaults
  const [widths, setWidths] = useState<Map<string, number>>(() => {
    const result = new Map<string, number>();
    // Load persisted widths if available
    let persisted: Record<string, number> = {};
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          persisted = JSON.parse(raw) as Record<string, number>;
        }
      } catch {
        // ignore parse errors
      }
    }
    for (const pane of panes) {
      if (pane.flex) continue; // flex panes don't have stored width
      const saved = persisted[pane.id];
      result.set(pane.id, typeof saved === "number" ? saved : pane.defaultWidth);
    }
    return result;
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<DragState | null>(null);
  const [isDraggingHandle, setIsDraggingHandle] = useState<number | null>(null);

  // Persist widths to localStorage when they change
  useEffect(() => {
    const toStore: Record<string, number> = {};
    widths.forEach((w, id) => {
      toStore[id] = w;
    });
    try {
      localStorage.setItem(storageKey, JSON.stringify(toStore));
    } catch {
      // ignore storage errors
    }
  }, [widths, storageKey]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, handleIndex: number) => {
      e.preventDefault();

      // handleIndex is the index of the left pane
      const startWidths = new Map(widths);

      draggingRef.current = {
        handleIndex,
        startX: e.clientX,
        startWidths,
      };
      setIsDraggingHandle(handleIndex);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [widths],
  );

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const drag = draggingRef.current;
      if (!drag) return;

      const delta = e.clientX - drag.startX;

      // Find left and right pane (the handle sits between adjacent visible panes)
      // drag.handleIndex is the pane index to the left of the handle
      const leftPane = panes[drag.handleIndex];

      // Find the next visible pane to the right
      let rightPane: PaneConfig | undefined;
      for (let j = drag.handleIndex + 1; j < panes.length; j++) {
        if (!collapsedPanes.has(panes[j].id)) {
          rightPane = panes[j];
          break;
        }
      }

      if (!leftPane || !rightPane) return;

      // When one pane is flex, only resize the non-flex pane
      if (leftPane.flex && rightPane.flex) return;

      if (leftPane.flex) {
        // Only resize the right (non-flex) pane — flex pane absorbs the difference
        const rightStart = drag.startWidths.get(rightPane.id) ?? rightPane.defaultWidth;
        const newRight = Math.max(rightPane.minWidth, rightStart - delta);
        setWidths((prev) => {
          const next = new Map(prev);
          next.set(rightPane!.id, newRight);
          return next;
        });
      } else if (rightPane.flex) {
        // Only resize the left (non-flex) pane — flex pane absorbs the difference
        const leftStart = drag.startWidths.get(leftPane.id) ?? leftPane.defaultWidth;
        const newLeft = Math.max(leftPane.minWidth, leftStart + delta);
        setWidths((prev) => {
          const next = new Map(prev);
          next.set(leftPane.id, newLeft);
          return next;
        });
      } else {
        // Both are fixed — resize both
        const leftStart = drag.startWidths.get(leftPane.id) ?? leftPane.defaultWidth;
        const rightStart = drag.startWidths.get(rightPane.id) ?? rightPane.defaultWidth;
        const newLeft = Math.max(leftPane.minWidth, leftStart + delta);
        const actualDelta = newLeft - leftStart;
        const newRight = Math.max(rightPane.minWidth, rightStart - actualDelta);
        setWidths((prev) => {
          const next = new Map(prev);
          next.set(leftPane.id, newLeft);
          next.set(rightPane!.id, newRight);
          return next;
        });
      }
    }

    function onMouseUp() {
      if (!draggingRef.current) return;
      draggingRef.current = null;
      setIsDraggingHandle(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [panes, collapsedPanes]);

  // Build visible pane indices (non-collapsed)
  const visiblePaneIndices = panes
    .map((pane, i) => ({ pane, i }))
    .filter(({ pane }) => !collapsedPanes.has(pane.id));

  return (
    <div ref={containerRef} className="flex h-full min-h-0 w-full overflow-hidden">
      {panes.map((pane, i) => {
        const isCollapsed = collapsedPanes.has(pane.id);

        if (isCollapsed) {
          return null;
        }

        // Determine if there's a handle after this pane
        // A handle appears between two adjacent visible panes
        const nextVisibleIndex = visiblePaneIndices.findIndex(({ i: vi }) => vi > i);
        const hasHandleAfter =
          nextVisibleIndex !== -1 &&
          !pane.flex; // flex pane shouldn't have a handle after it in a typical layout

        const paneWidth = pane.flex ? undefined : (widths.get(pane.id) ?? pane.defaultWidth);
        const isCurrentlyDragging = isDraggingHandle === i;

        return (
          <div key={pane.id} className="flex h-full min-h-0">
            {/* Pane content */}
            <div
              className="h-full min-h-0 overflow-hidden border-r border-border"
              style={
                pane.flex
                  ? { flex: 1, minWidth: pane.minWidth }
                  : { width: paneWidth, flexShrink: 0 }
              }
            >
              {pane.content}
            </div>

            {/* Drag handle after this pane (before the next visible pane) */}
            {hasHandleAfter && (
              <div
                onMouseDown={(e) => handleMouseDown(e, i)}
                className={[
                  "h-full w-1 flex-shrink-0 cursor-col-resize transition-colors z-10",
                  isCurrentlyDragging ? "bg-accent" : "bg-transparent hover:bg-accent",
                ].join(" ")}
              />
            )}
          </div>
        );
      })}

      {/* Flex filler: if no pane is flex, this fills remaining space */}
      {!panes.some((p) => p.flex && !collapsedPanes.has(p.id)) && (
        <div className="flex-1" />
      )}
    </div>
  );
}
