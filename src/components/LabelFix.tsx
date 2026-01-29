 "use client";

import { useEffect } from "react";

export default function LabelFix() {
  useEffect(() => {
    const map: [string, string][] = [
      ["スタッフ用", "アルバイト用"],
      ["スタッフ", "アルバイト"],
    ];

    const replaceTextNode = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        let txt = node.nodeValue || "";
        let changed = false;
        for (const [from, to] of map) {
          if (txt.includes(from)) {
            txt = txt.split(from).join(to);
            changed = true;
          }
        }
        if (changed) node.nodeValue = txt;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        if (el.tagName === "SCRIPT" || el.tagName === "STYLE") return;
        for (let i = 0; i < el.childNodes.length; i++) {
          replaceTextNode(el.childNodes[i]);
        }
      }
    };

    // initial pass
    try {
      replaceTextNode(document.body);
    } catch (e) {
      // ignore
    }

    // observe dynamic changes for a while
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "characterData") {
          replaceTextNode(m.target);
        } else {
          for (const n of Array.from(m.addedNodes)) {
            try {
              replaceTextNode(n);
            } catch (e) {}
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    // keep observing for 2 minutes then disconnect
    const timeout = setTimeout(() => observer.disconnect(), 2 * 60 * 1000);

    return () => {
      observer.disconnect();
      clearTimeout(timeout);
    };
  }, []);

  return null;
}

