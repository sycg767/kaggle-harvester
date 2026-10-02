import { useEffect, useState } from 'react';

// Preserve list navigation within this browser tab; storage restrictions still
// allow the controls to work for the current page.
export function useSessionState<T extends string | number | boolean>(key: string, fallback: T) {
  type Value = T extends string ? string : T extends number ? number : boolean;
  const [value, setValue] = useState<Value>(() => {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (typeof saved === typeof fallback && (typeof saved !== 'number' || Number.isFinite(saved) && saved > 0)) return saved as Value;
    } catch { /* Use the default when browser storage is unavailable. */ }
    return fallback as unknown as Value;
  });
  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Optional persistence. */ }
  }, [key, value]);
  return [value, setValue] as const;
}
