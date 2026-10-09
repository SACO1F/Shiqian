import { useLayoutEffect, useRef } from "react";
import type { FloatingOperation } from "./useFloatingHistory";
import { motionEase, reducedMotion } from "./microMotion";

export function FloatingHistory({
  operations,
  ready,
}: {
  operations: FloatingOperation[];
  ready: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const previous = useRef(
    new Map<string, { element: HTMLElement; rect: DOMRect }>(),
  );
  const wasReady = useRef(false);
  useLayoutEffect(() => {
    const element = root.current;
    const next = new Map<string, { element: HTMLElement; rect: DOMRect }>();
    element
      ?.querySelectorAll<HTMLElement>("li[data-operation-id]")
      .forEach((li) =>
        next.set(li.dataset.operationId!, {
          element: li,
          rect: li.getBoundingClientRect(),
        }),
      );
    const old = previous.current;
    previous.current = next;
    const animate = ready && wasReady.current && !reducedMotion();
    wasReady.current = ready;
    if (!animate || !element) return;
    const motions: Animation[] = [],
      ghosts: HTMLElement[] = [];
    next.forEach(({ element: li, rect }, id) => {
      const prior = old.get(id);
      const offset = prior ? prior.rect.y - rect.y : -6;
      motions.push(
        li.animate(
          [
            { transform: `translateY(${offset}px)`, opacity: prior ? 1 : 0 },
            { transform: "translateY(0)", opacity: 1 },
          ],
          { duration: 200, easing: motionEase },
        ),
      );
    });
    const bounds = element.getBoundingClientRect();
    old.forEach(({ element: li, rect }, id) => {
      if (next.has(id)) return;
      const ghost = document.createElement("div");
      ghost.className = "history-ghost";
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      ghost.innerHTML = li.innerHTML;
      Object.assign(ghost.style, {
        top: `${rect.y - bounds.y}px`,
        left: `${rect.x - bounds.x}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      element.append(ghost);
      ghosts.push(ghost);
      const motion = ghost.animate(
        [
          { opacity: 1, transform: "translateY(0)" },
          { opacity: 0, transform: "translateY(6px)" },
        ],
        { duration: 140, easing: motionEase, fill: "forwards" },
      );
      void motion.finished.then(() => ghost.remove()).catch(() => {});
      motions.push(motion);
    });
    return () => {
      motions.forEach((m) => m.cancel());
      ghosts.forEach((g) => g.remove());
    };
  }, [operations, ready]);
  if (!operations.length) return null;
  return (
    <footer
      ref={root}
      className="floating-history"
      role="log"
      aria-live="polite"
      aria-label="最近三步操作"
    >
      <ol>
        {operations.map((operation) => (
          <li
            key={operation.id}
            data-operation-id={operation.id}
            title={operation.text}
          >
            <span className="operation-dot" />
            <span>{operation.text}</span>
            <time dateTime={new Date(operation.time).toISOString()}>
              {new Date(operation.time).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </li>
        ))}
      </ol>
    </footer>
  );
}
