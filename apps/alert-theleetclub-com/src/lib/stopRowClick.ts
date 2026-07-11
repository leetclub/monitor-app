import type { MouseEvent, PointerEvent, SyntheticEvent, TouchEvent } from 'react';
import { isAnyModalOpen } from '@/lib/useAlertModal';

/** Elements inside a clickable table row that must not open the row detail modal. */
export const ROW_INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  '[data-stop-row-click]',
  '.opContactBar',
  '.operatorCell',
  '.operatorCellBtn',
  '.salesStackBtn',
  '.salesStackTarget',
  '.freqTrendOpen',
  '.freqScoreOpen',
  '.freqGapOpen',
  '.qaVisitCellBtn',
  '.cleaningCellBtn',
  '.callOpCellBtn',
  '.callAmCellBtn',
  '.attendanceWorkflowBtn',
  '.linkGo',
].join(', ');

const TOUCH_ACTIVATED = 'touchActivated';
const TOUCH_ACTIVATED_MS = 600;
let rowPopupActivatingUntil = 0;

function markRowPopupActivating(): void {
  rowPopupActivatingUntil = Date.now() + TOUCH_ACTIVATED_MS;
}

function isRowPopupActivating(): boolean {
  return Date.now() < rowPopupActivatingUntil;
}

/** iPad Safari often reports pointerType "mouse" for finger taps. */
function shouldActivateFromPointer(pointerType: string): boolean {
  if (pointerType !== 'mouse') return true;
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

export type RowTapStore = { current: HTMLElement | null };

export function rowInteractiveElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.closest(ROW_INTERACTIVE_SELECTOR) as HTMLElement | null;
}

export function isRowInteractiveTarget(target: EventTarget | null): boolean {
  return Boolean(rowInteractiveElement(target));
}

/** Record which cell control the pointer started on (capture, before child stopPropagation). */
export function captureRowTapTarget(target: EventTarget | null, store: RowTapStore): void {
  store.current = rowInteractiveElement(target);
}

export function clearRowTapTarget(store: RowTapStore): void {
  store.current = null;
}

function rowTapActivateElement(tapEl: HTMLElement): HTMLElement {
  if (tapEl.matches('[data-stop-row-click]')) return tapEl;
  const bound = tapEl.closest('[data-stop-row-click]') as HTMLElement | null;
  return bound ?? tapEl;
}

function markTouchActivated(el: HTMLElement): void {
  el.dataset[TOUCH_ACTIVATED] = '1';
  window.setTimeout(() => {
    delete el.dataset[TOUCH_ACTIVATED];
  }, TOUCH_ACTIVATED_MS);
}

function consumeTouchActivated(el: HTMLElement): boolean {
  if (el.dataset[TOUCH_ACTIVATED] !== '1') return false;
  delete el.dataset[TOUCH_ACTIVATED];
  return true;
}

/** Safari ghost-click on <tr> — walk composedPath for the real cell control. */
export function eventPathIncludesRowInteractive(event: MouseEvent<HTMLElement>): boolean {
  const path = event.nativeEvent.composedPath?.();
  if (path?.length) {
    for (const n of path) {
      if (n instanceof HTMLElement && rowInteractiveElement(n)) return true;
    }
  }
  return isRowInteractiveTarget(event.target);
}

/**
 * Row click: open detail for blank row taps; forward ghost clicks to the control
 * that was pressed (iPad/Safari retarget). Never block popup when ghost lands on the button.
 */
export function handleRowClickActivate(
  event: MouseEvent<HTMLElement>,
  store: RowTapStore,
  openRowDetail: () => void,
): void {
  if (isAnyModalOpen() || isRowPopupActivating()) {
    store.current = null;
    return;
  }

  const tapEl = store.current;
  store.current = null;

  if (tapEl) {
    const activateEl = rowTapActivateElement(tapEl);
    if (consumeTouchActivated(activateEl)) {
      return;
    }
    const targetNode = event.target;
    const clickedControl =
      targetNode instanceof Node &&
      (targetNode === activateEl || activateEl.contains(targetNode));
    const ghostRetarget =
      targetNode instanceof Node &&
      targetNode !== activateEl &&
      !activateEl.contains(targetNode);
    if (ghostRetarget || !clickedControl) {
      activateEl.click();
    }
    return;
  }

  if (eventPathIncludesRowInteractive(event)) return;
  openRowDetail();
}

/** Stop row-level click handlers (Safari/iPad often retarget `click` to `<tr>`). */
export function stopRowActivation(e: SyntheticEvent): void {
  e.stopPropagation();
}

/**
 * Bind cell buttons/links so row detail does not steal the tap (iPad-safe).
 * Fires onActivate on touchEnd/pointerUp first; click is fallback for mouse.
 */
export function bindStopRowClick(onActivate?: () => void): {
  'data-stop-row-click': true;
  onPointerDownCapture: (e: PointerEvent) => void;
  onPointerDown: (e: PointerEvent) => void;
  onTouchEnd: (e: TouchEvent) => void;
  onPointerUp: (e: PointerEvent) => void;
  onPointerCancel: (e: PointerEvent) => void;
  onClick: (e: MouseEvent) => void;
} {
  const fireTouchActivate = (e: SyntheticEvent) => {
    stopRowActivation(e);
    if (!onActivate) return;
    const el = e.currentTarget;
    if (!(el instanceof HTMLElement)) return;
    if (el.dataset[TOUCH_ACTIVATED] === '1') return;
    markTouchActivated(el);
    markRowPopupActivating();
    onActivate();
  };

  return {
    'data-stop-row-click': true,
    onPointerDownCapture: stopRowActivation,
    onPointerDown: stopRowActivation,
    onTouchEnd: (e) => {
      e.preventDefault();
      fireTouchActivate(e);
    },
    onPointerUp: (e) => {
      if (!shouldActivateFromPointer(e.pointerType)) return;
      fireTouchActivate(e);
    },
    onPointerCancel: (e) => {
      stopRowActivation(e);
      if (e.currentTarget instanceof HTMLElement) {
        delete e.currentTarget.dataset[TOUCH_ACTIVATED];
      }
    },
    onClick: (e) => {
      stopRowActivation(e);
      if (!onActivate) return;
      const el = e.currentTarget;
      if (!(el instanceof HTMLElement)) return;
      if (consumeTouchActivated(el)) return;
      markRowPopupActivating();
      onActivate();
    },
  };
}
