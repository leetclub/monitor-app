import { useEffect, type MouseEvent, type TouchEvent } from 'react';

export { getAlertModalPortal } from './alertModalPortal';

let modalOpenCount = 0;

export function registerModalOpen(): () => void {
  modalOpenCount += 1;
  if (modalOpenCount === 1) {
    document.body.classList.add('alert-modal-open');
  }
  return () => {
    modalOpenCount = Math.max(0, modalOpenCount - 1);
    if (modalOpenCount === 0) {
      document.body.classList.remove('alert-modal-open');
    }
  };
}

export function isAnyModalOpen(): boolean {
  return modalOpenCount > 0;
}

/** Escape + body guard while a modal is mounted. */
export function useAlertModal(onClose: () => void): void {
  useEffect(() => {
    const unregister = registerModalOpen();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      unregister();
    };
  }, [onClose]);
}

export function modalBackdropHandlers(onClose: () => void): {
  onMouseDown: (e: MouseEvent) => void;
  onClick: (e: MouseEvent) => void;
  onTouchEnd: (e: TouchEvent) => void;
} {
  return {
    onMouseDown: (e) => {
      e.stopPropagation();
      if (e.target === e.currentTarget) onClose();
    },
    onClick: (e) => e.stopPropagation(),
    onTouchEnd: (e) => {
      e.stopPropagation();
      if (e.target === e.currentTarget) onClose();
    },
  };
}

export function modalPanelHandlers(): {
  onMouseDown: (e: MouseEvent) => void;
  onClick: (e: MouseEvent) => void;
  onTouchStart: (e: TouchEvent) => void;
} {
  return {
    onMouseDown: (e) => e.stopPropagation(),
    onClick: (e) => e.stopPropagation(),
    onTouchStart: (e) => e.stopPropagation(),
  };
}
