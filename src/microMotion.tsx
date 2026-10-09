import { useLayoutEffect, useRef, type RefObject } from "react";
import type { Tag } from "./api";

export const motionEase = "cubic-bezier(0.22, 1, 0.36, 1)";
export const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

// Compare semantic tag state, so refreshes and virtual remounts don't replay arrivals.
export function useTagArrival(
  container: RefObject<HTMLElement | null>,
  scope: string | undefined,
  tags: Tag[],
) {
  const previous = useRef<
    { scope?: string; tags: Map<string, boolean> } | undefined
  >(undefined);
  const active = useRef<Animation[]>([]);
  useLayoutEffect(() => {
    const next = new Map(
      tags.map((tag) => [
        tag.id,
        tag.source === "ai" ? !!tag.ai?.confirmed : !!tag.accepted,
      ]),
    );
    const old = previous.current;
    previous.current = { scope, tags: next };
    if (!scope || old?.scope !== scope || reducedMotion()) return;
    for (const tag of tags) {
      if (old.tags.has(tag.id) && (old.tags.get(tag.id) || !next.get(tag.id)))
        continue;
      const element = [
        ...(container.current?.querySelectorAll<HTMLElement>(
          "[data-motion-tag]",
        ) ?? []),
      ].find((el) => el.dataset.motionTag === tag.id);
      if (!element) continue;
      active.current.push(
        element.animate(
          [
            { opacity: 0.55, transform: "translateY(4px) scale(0.97)" },
            { opacity: 1, transform: "translateY(0) scale(1)" },
          ],
          { duration: 200, easing: motionEase },
        ),
      );
    }
    active.current = active.current.filter(
      (animation) => animation.playState === "running",
    );
  }, [container, scope, tags]);
  useLayoutEffect(() => () => active.current.forEach((a) => a.cancel()), []);
}

export function SelectionCheck({
  checked,
  small = false,
}: {
  checked: boolean;
  small?: boolean;
}) {
  return (
    <span
      className={`selection-check ${checked ? "is-checked" : ""}`}
      aria-hidden="true"
    >
      <svg
        width={small ? 12 : 14}
        height={small ? 12 : 14}
        viewBox="0 0 24 24"
        fill="none"
      >
        <path
          d="m5 12 4 4L19 6"
          pathLength="1"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
