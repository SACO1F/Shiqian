import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import "./warm-tooltip.css";

export function WarmTooltip({
  text,
  children,
}: {
  text: string;
  children: ReactElement<{ "aria-describedby"?: string }>;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState({ left: -10000, top: -10000 });
  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setMounted(true);
      setVisible(true);
    }, 180);
  };
  const close = () => {
    clearTimeout(timer.current);
    setVisible(false);
    timer.current = setTimeout(() => setMounted(false), 120);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!mounted || !anchor.current || !panel.current) return;
    const a = anchor.current.getBoundingClientRect();
    const p = panel.current.getBoundingClientRect();
    const below = a.bottom + 9;
    setPosition({
      left: Math.max(
        8,
        Math.min(a.left + (a.width - p.width) / 2, innerWidth - p.width - 8),
      ),
      top:
        below + p.height <= innerHeight - 8
          ? below
          : Math.max(8, a.top - p.height - 9),
    });
    const dismiss = () => close();
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [mounted, text]);
  return (
    <>
      <span
        ref={anchor}
        className="warm-tooltip-anchor"
        onMouseEnter={show}
        onMouseLeave={close}
        onFocus={show}
        onBlur={close}
        onClick={close}
        onKeyDown={(event) => {
          if (event.key === "Escape" && mounted) {
            event.stopPropagation();
            close();
          }
        }}
      >
        {cloneElement(children, {
          "aria-describedby": mounted ? id : undefined,
        })}
      </span>
      {mounted &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="tooltip"
            className="warm-tooltip"
            data-visible={visible}
            style={position}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
