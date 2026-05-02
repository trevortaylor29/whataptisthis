"use client";

import { useEffect, useState } from "react";
import FingerprintJS from "@fingerprintjs/fingerprintjs";

/**
 * Open-source FingerprintJS visitor id for server-side rate limits.
 */
export function useVisitorId(): {
  visitorId: string | null;
  ready: boolean;
} {
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fp = await FingerprintJS.load();
        const result = await fp.get();
        if (!cancelled) setVisitorId(result.visitorId);
      } catch {
        if (!cancelled) setVisitorId(null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { visitorId, ready };
}
