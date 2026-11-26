import { QIE_ID_HOSTED_URL } from "./config";

/** The QIE ID widget's controls, set by loader.qie.digital once it has loaded. */
interface QieWidget {
  open(): void;
  close(): void;
  toggle(): void;
  onSuccess(cb: (order: { orderId: string; domain: string }) => void): void;
}
declare global {
  interface Window {
    QieWidget?: QieWidget;
  }
}

/** Opens the QIE ID widget on this page, or QIE's hosted page if the widget hasn't loaded. */
export function openQieIdWidget() {
  if (typeof window === "undefined") return;
  if (window.QieWidget) window.QieWidget.open();
  else window.open(QIE_ID_HOSTED_URL, "_blank", "noopener");
}

/** Fired after a QIE ID is bought through the widget, so names refresh. */
export const QIE_ID_BOUGHT = "thesis:qieid-bought";
