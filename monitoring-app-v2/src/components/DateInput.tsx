import { forwardRef, type InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement>;

/**
 * Some Chromium/PWA builds can fail to open the native date picker reliably when the input
 * is inside complex layouts. Calling `showPicker()` (when available) makes date selection consistent.
 */
export const DateInput = forwardRef<HTMLInputElement, Props>(function DateInput(props, ref) {
  const { onPointerDown, onMouseDown, onFocus, ...rest } = props;

  const tryShowPicker = (el: HTMLInputElement | null) => {
    if (!el) return;
    try {
      (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
    } catch {
      /* ignore */
    }
  };

  return (
    <input
      {...rest}
      ref={ref}
      onPointerDown={(e) => {
        onPointerDown?.(e);
        tryShowPicker(e.currentTarget);
      }}
      onMouseDown={(e) => {
        onMouseDown?.(e);
        tryShowPicker(e.currentTarget);
      }}
      onFocus={(e) => {
        onFocus?.(e);
        tryShowPicker(e.currentTarget);
      }}
    />
  );
});

