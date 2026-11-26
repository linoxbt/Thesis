"use client";

import Script from "next/script";
import { QIE_ID_WIDGET_ID, QIE_ID_WIDGET_URL } from "@/lib/config";
import { QIE_ID_BOUGHT } from "@/lib/qieidWidget";

/**
 * QIE ID widget: a "Get an ID" launcher (bottom right) that sells .qie IDs in
 * QIE's own frame. After a purchase, the app looks names up again.
 */
export function QieIdWidget() {
  return (
    <Script
      id="qie-id-widget"
      type="module"
      src="https://loader.qie.digital/loader.js"
      strategy="afterInteractive"
      data-widget-id={QIE_ID_WIDGET_ID}
      data-widget-url={QIE_ID_WIDGET_URL}
      data-launcher-text="Get an ID"
      onReady={() => {
        // The loader sets window.QieWidget once the page body exists.
        let tries = 0;
        const hook = () => {
          if (window.QieWidget) window.QieWidget.onSuccess((order) => window.dispatchEvent(new CustomEvent(QIE_ID_BOUGHT, { detail: order })));
          else if (++tries < 40) setTimeout(hook, 250);
        };
        hook();
      }}
    />
  );
}
