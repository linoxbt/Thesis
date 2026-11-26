import { QIE_ID_HOSTED_URL, QIE_ID_WIDGET_ID, QIE_ID_WIDGET_URL } from "./config";

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

/** Fired after a QIE ID is bought through the widget, so names refresh. */
export const QIE_ID_BOUGHT = "thesis:qieid-bought";

let loading: Promise<QieWidget | null> | null = null;

/**
 * Loads QIE's widget script the first time someone asks for it, not on every
 * page: third-party code only runs for people who want to buy an ID.
 */
function loadWidget(): Promise<QieWidget | null> {
  if (window.QieWidget) return Promise.resolve(window.QieWidget);
  if (loading) return loading;
  const p = new Promise<QieWidget | null>((resolve) => {
    const s = document.createElement("script");
    s.type = "module";
    s.src = "https://loader.qie.digital/loader.js";
    s.dataset.widgetId = QIE_ID_WIDGET_ID;
    s.dataset.widgetUrl = QIE_ID_WIDGET_URL;
    s.dataset.launcherText = "Get an ID";
    let tries = 0;
    const wait = () => {
      if (window.QieWidget) {
        window.QieWidget.onSuccess((order) => window.dispatchEvent(new CustomEvent(QIE_ID_BOUGHT, { detail: order })));
        resolve(window.QieWidget);
      } else if (++tries < 20) setTimeout(wait, 200); // within the click's ~5 s pop-up allowance
      else resolve(null);
    };
    s.onload = wait;
    s.onerror = () => resolve(null);
    document.body.appendChild(s);
  }).then((w) => {
    if (!w) loading = null; // let a later click try again
    return w;
  });
  loading = p;
  return p;
}

/** Opens the QIE ID widget on this page, or QIE's hosted page if the widget can't load. */
export function openQieIdWidget() {
  if (typeof window === "undefined") return;
  if (window.QieWidget) return window.QieWidget.open();
  void loadWidget().then((w) => {
    if (w) w.open();
    else window.open(QIE_ID_HOSTED_URL, "_blank", "noopener");
  });
}
