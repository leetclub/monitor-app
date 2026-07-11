/** Dedicated stacking layer for alert popups (iPad / iOS Safari safe). */
export const ALERT_MODAL_PORTAL_ID = 'alert-modal-root';

export function getAlertModalPortal(): HTMLElement {
  return document.getElementById(ALERT_MODAL_PORTAL_ID) ?? document.body;
}
