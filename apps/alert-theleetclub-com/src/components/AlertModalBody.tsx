import type { ReactNode } from 'react';

/** Staggered cinematic body sections inside alert popups. */
export function AlertModalBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={className ? `alertModalBody ${className}` : 'alertModalBody'}>{children}</div>;
}
