import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

type SheetBehavior =
  | { kind: "none" }
  | { kind: "drag-handle"; availability: "always" | "compact" };

type PointerSample = Readonly<{
  clientX: number;
  clientY: number;
  atMs: number;
}>;

type SheetDragState =
  | { kind: "idle" }
  | {
      kind: "dragging";
      pointerId: number;
      origin: PointerSample;
      previous: PointerSample;
      current: PointerSample;
      offsetPx: number;
    }
  | {
      kind: "settling";
      destination: "origin" | "dismissed";
      offsetPx: number;
    };

type SheetRelease =
  | { kind: "restore" }
  | { kind: "dismiss"; reason: "distance" | "velocity" };

interface ModalLayerProps {
  open: boolean;
  onDismiss: () => void;
  labelledBy: string;
  describedBy?: string;
  surfaceId?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
  backdropClassName: string;
  surfaceClassName: string;
  sheet: SheetBehavior;
  children: ReactNode;
}

const modalStack: symbol[] = [];
let bodyLockCount = 0;
let bodyOverflowBeforeLock = "";

function focusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [
    ...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0,
  );
}

function removeFromModalStack(token: symbol): void {
  const index = modalStack.indexOf(token);
  if (index !== -1) modalStack.splice(index, 1);
}

function acquireBodyLock(): () => void {
  if (bodyLockCount === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyLockCount += 1;
  return () => {
    bodyLockCount = Math.max(0, bodyLockCount - 1);
    if (bodyLockCount === 0) {
      document.body.style.overflow = bodyOverflowBeforeLock;
    }
  };
}

function decideSheetRelease(input: {
  offsetPx: number;
  previous: Readonly<{ clientY: number; atMs: number }>;
  current: Readonly<{ clientY: number; atMs: number }>;
  sheetHeightPx: number;
}): SheetRelease {
  if (input.offsetPx <= 0) return { kind: "restore" };

  const distanceThreshold = Math.min(
    180,
    Math.max(96, input.sheetHeightPx / 3),
  );
  if (input.offsetPx >= distanceThreshold) {
    return { kind: "dismiss", reason: "distance" };
  }

  const elapsedMs = input.current.atMs - input.previous.atMs;
  const velocity =
    elapsedMs > 0
      ? (input.current.clientY - input.previous.clientY) / elapsedMs
      : 0;
  return input.offsetPx >= 24 && velocity >= 0.55
    ? { kind: "dismiss", reason: "velocity" }
    : { kind: "restore" };
}

function dismissOnBackdropClick(
  event: ReactMouseEvent<HTMLDivElement>,
  onDismiss: () => void,
): void {
  if (event.button === 0 && event.target === event.currentTarget) {
    onDismiss();
  }
}

function SheetDragHandle({
  availability,
  surfaceRef,
  onDismiss,
}: {
  availability: "always" | "compact";
  surfaceRef: RefObject<HTMLElement | null>;
  onDismiss: () => void;
}) {
  const dragStateRef = useRef<SheetDragState>({ kind: "idle" });
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(
    () => () => {
      if (settleTimerRef.current !== null) {
        clearTimeout(settleTimerRef.current);
      }
    },
    [],
  );

  function finishSettling(destination: "origin" | "dismissed"): void {
    const surface = surfaceRef.current;
    if (!surface) return;
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
    }

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const complete = () => {
      settleTimerRef.current = null;
      if (destination === "dismissed") {
        onDismissRef.current();
        return;
      }
      surface.style.removeProperty("--sheet-drag-y");
      delete surface.dataset["sheetSettling"];
      dragStateRef.current = { kind: "idle" };
    };

    surface.dataset["sheetSettling"] = destination;
    if (destination === "origin") {
      surface.style.setProperty("--sheet-drag-y", "0px");
    } else {
      surface.style.setProperty(
        "--sheet-drag-y",
        `${window.innerHeight + surface.getBoundingClientRect().height}px`,
      );
    }

    if (reducedMotion) {
      complete();
    } else {
      settleTimerRef.current = setTimeout(complete, 200);
    }
  }

  function restoreDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    const state = dragStateRef.current;
    if (state.kind !== "dragging" || state.pointerId !== event.pointerId)
      return;
    dragStateRef.current = {
      kind: "settling",
      destination: "origin",
      offsetPx: state.offsetPx,
    };
    finishSettling("origin");
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!event.isPrimary || event.button !== 0) return;
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    const surface = surfaceRef.current;
    if (surface) {
      delete surface.dataset["sheetSettling"];
    }
    const sample = {
      clientX: event.clientX,
      clientY: event.clientY,
      atMs: event.timeStamp,
    };
    dragStateRef.current = {
      kind: "dragging",
      pointerId: event.pointerId,
      origin: sample,
      previous: sample,
      current: sample,
      offsetPx: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const state = dragStateRef.current;
    if (state.kind !== "dragging" || state.pointerId !== event.pointerId) {
      return;
    }

    const current = {
      clientX: event.clientX,
      clientY: event.clientY,
      atMs: event.timeStamp,
    };
    const horizontalDistance = Math.abs(current.clientX - state.origin.clientX);
    const verticalDistance = current.clientY - state.origin.clientY;
    const activated =
      verticalDistance >= 10 && verticalDistance > horizontalDistance;
    const offsetPx = activated ? verticalDistance : 0;
    dragStateRef.current = {
      ...state,
      previous: state.current,
      current,
      offsetPx,
    };
    if (activated) {
      surfaceRef.current?.style.setProperty("--sheet-drag-y", `${offsetPx}px`);
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    const state = dragStateRef.current;
    if (state.kind !== "dragging" || state.pointerId !== event.pointerId) {
      return;
    }
    const surface = surfaceRef.current;
    if (!surface) {
      dragStateRef.current = { kind: "idle" };
      return;
    }

    const release = decideSheetRelease({
      offsetPx: state.offsetPx,
      previous: state.previous,
      current: state.current,
      sheetHeightPx: surface.getBoundingClientRect().height,
    });
    const destination = release.kind === "dismiss" ? "dismissed" : "origin";
    dragStateRef.current = {
      kind: "settling",
      destination,
      offsetPx: state.offsetPx,
    };
    finishSettling(destination);
  }

  return (
    <div
      className="sheet-drag-handle"
      data-availability={availability}
      data-sheet-drag-handle
      aria-hidden="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={restoreDrag}
      onLostPointerCapture={restoreDrag}
    >
      <span />
    </div>
  );
}

export function ModalLayer({
  open,
  onDismiss,
  labelledBy,
  describedBy,
  surfaceId,
  returnFocusRef,
  backdropClassName,
  surfaceClassName,
  sheet,
  children,
}: ModalLayerProps) {
  const tokenRef = useRef(Symbol("modal-layer"));
  const surfaceRef = useRef<HTMLElement>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    const token = tokenRef.current;
    const previouslyFocused = document.activeElement;
    modalStack.push(token);
    const releaseBodyLock = acquireBodyLock();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (modalStack.at(-1) !== token) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onDismissRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(surfaceRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        surfaceRef.current?.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    const focusFrame = requestAnimationFrame(() => {
      focusableElements(surfaceRef.current)[0]?.focus();
    });

    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      removeFromModalStack(token);
      releaseBodyLock();
      const focusTarget = returnFocusRef?.current ?? previouslyFocused;
      if (
        focusTarget instanceof HTMLElement &&
        document.contains(focusTarget)
      ) {
        focusTarget.focus();
      }
    };
  }, [open, returnFocusRef]);

  if (!open) return null;
  const layer = (
    <div
      className={backdropClassName}
      role="presentation"
      onClick={(event) => dismissOnBackdropClick(event, onDismissRef.current)}
    >
      <section
        ref={surfaceRef}
        id={surfaceId}
        className={`modal-surface ${surfaceClassName}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        {sheet.kind === "drag-handle" ? (
          <SheetDragHandle
            availability={sheet.availability}
            surfaceRef={surfaceRef}
            onDismiss={onDismiss}
          />
        ) : null}
        {children}
      </section>
    </div>
  );
  return typeof document === "undefined"
    ? layer
    : createPortal(layer, document.body);
}

export const __modalLayerTesting = { decideSheetRelease };
