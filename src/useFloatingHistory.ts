import { useCallback, useEffect, useState } from "react";

export type FloatingOperation = { id: string; text: string; time: number };
export function useFloatingHistory(dataPath?: string) {
  const [operations, setOperations] = useState<FloatingOperation[]>([]);
  const [hydratedKey, setHydratedKey] = useState<string>();
  const key = dataPath ? `shiqian:floating-operations:${dataPath}` : undefined;
  useEffect(() => {
    if (!key) return;
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) || "[]");
      setOperations(
        Array.isArray(saved)
          ? saved
              .filter(
                (item) =>
                  typeof item?.id === "string" &&
                  typeof item?.text === "string" &&
                  typeof item?.time === "number",
              )
              .slice(0, 3)
          : [],
      );
    } catch {
      setOperations([]);
    }
    setHydratedKey(key);
  }, [key]);
  const record = useCallback(
    (text: string) => {
      const next = { id: crypto.randomUUID(), text, time: Date.now() };
      setOperations((old) => {
        const items = [next, ...old].slice(0, 3);
        if (key) {
          try {
            localStorage.setItem(key, JSON.stringify(items));
          } catch {
            /* History must not block annotation. */
          }
        }
        return items;
      });
    },
    [key],
  );
  return { operations, record, ready: !!key && hydratedKey === key };
}
