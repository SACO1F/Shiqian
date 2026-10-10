import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import "./glide-select.css";

// Inspired by React Bits Glide Select's pop and sliding highlight; uses the app's icons and theme.
export function GlideSelect({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 176,
    height: 280,
    above: false,
  });
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const mounted = open || closing;
  function close() {
    setOpen(false);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setClosing(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setClosing(false), 120);
  }
  function show() {
    if (disabled || !options.length) return;
    clearTimeout(timer.current);
    setClosing(false);
    setActive(selected);
    setOpen(true);
  }
  function pick(index: number) {
    if (options[index] && options[index].value !== value)
      onChange(options[index].value);
    close();
    trigger.current?.focus();
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setClosing(false);
    }
  }, [disabled]);
  useLayoutEffect(() => {
    if (!mounted) return;
    const place = () => {
      const r = trigger.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(Math.max(176, r.width), innerWidth - 16);
      const desired = Math.min(280, options.length * 32 + 14);
      const below = innerHeight - r.bottom - 16;
      const above = below < desired && r.top - 16 > below;
      const height = Math.max(
        32,
        Math.min(desired, above ? r.top - 16 : below),
      );
      setPosition({
        left: Math.max(8, Math.min(r.left, innerWidth - width - 8)),
        top: above ? r.top - height - 6 : r.bottom + 6,
        width,
        height,
        above,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [mounted, options.length]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node)
      )
        close();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open)
      menu.current
        ?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  return (
    <>
      <button
        ref={trigger}
        className="glide-select-trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={mounted ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            close();
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            if (!open) show();
            else
              setActive(
                (index) =>
                  (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    options.length) %
                  options.length,
              );
          } else if ((event.key === "Home" || event.key === "End") && open) {
            event.preventDefault();
            setActive(event.key === "Home" ? 0 : options.length - 1);
          } else if ((event.key === "Enter" || event.key === " ") && open) {
            event.preventDefault();
            event.stopPropagation();
            pick(active);
          } else if (event.key === "Tab" && open) close();
        }}
      >
        <span>{options[selected]?.label || value}</span>
        <ChevronDown size={13} className={open ? "is-open" : ""} />
      </button>
      {mounted &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="listbox"
            aria-label={ariaLabel}
            className={`glide-select-menu ${closing ? "is-closing" : ""} ${position.above ? "is-above" : ""}`}
            inert={closing}
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.height,
            }}
          >
            <div className="glide-select-options">
              <div
                className="glide-select-highlight"
                style={{ transform: `translateY(${active * 32}px)` }}
              />
              {options.map((option, index) => (
                <button
                  type="button"
                  key={option.value}
                  id={`${id}-${index}`}
                  data-option-index={index}
                  role="option"
                  aria-selected={option.value === value}
                  tabIndex={-1}
                  onPointerEnter={() => setActive(index)}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => pick(index)}
                >
                  <span>{option.label}</span>
                  {option.value === value && <Check size={13} />}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
