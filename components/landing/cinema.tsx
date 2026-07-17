"use client";

// Кинематографичные скролл-примитивы лендинга. Без внешних библиотек:
// IntersectionObserver для reveal-эффектов, rAF для скролл-прогресса.
// prefers-reduced-motion уважается везде (CSS в globals.css + хук ниже).

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Reveal при входе в вьюпорт. Дочерние элементы с классом `cine` внутри
 *  группы поднимаются каскадом (задержка через style={{ "--d": "0.1s" }}). */
export function Cine({
  children,
  className = "",
  as: Tag = "div",
  threshold = 0.18,
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "li" | "figure";
  threshold?: number;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.classList.add("is-in");
            io.disconnect();
          }
        }
      },
      { threshold, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return (
    <Tag ref={ref as never} className={className}>
      {children}
    </Tag>
  );
}

/** Прогресс прокрутки элемента: 0 — верх элемента у нижней кромки экрана,
 *  1 — низ элемента у верхней кромки. rAF-троттлинг. */
export function useScrollProgress(ref: React.RefObject<HTMLElement>): number {
  const [p, setP] = useState(0);
  const frame = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      frame.current = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const total = rect.height - vh;
      const raw = total > 0 ? -rect.top / total : (vh - rect.top) / (vh + rect.height);
      setP(Math.min(1, Math.max(0, raw)));
    };
    const onScroll = () => {
      if (!frame.current) frame.current = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [ref]);
  return p;
}

/** Sticky-сцена: высокий контейнер (heightVh) с прилипшим экраном внутри.
 *  children получает прогресс 0..1 по мере прокрутки контейнера. */
export function StickyScene({
  heightVh = 300,
  className = "",
  children,
}: {
  heightVh?: number;
  className?: string;
  children: (p: number) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const p = useScrollProgress(ref);
  const reduced = useReducedMotion();
  return (
    <div ref={ref} style={{ height: `${heightVh}vh` }} className={className}>
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">
        {children(reduced ? 1 : p)}
      </div>
    </div>
  );
}

/** Лёгкий параллакс: сдвиг по Y пропорционально положению в вьюпорте. */
export function Parallax({
  amount = 40,
  className = "",
  children,
}: {
  amount?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const center = (rect.top + rect.height / 2 - vh / 2) / vh; // -1..1
      el.style.transform = `translateY(${(-center * amount).toFixed(1)}px)`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [amount, reduced]);
  return (
    <div ref={ref} className={className} style={{ willChange: "transform" }}>
      {children}
    </div>
  );
}

/** Полоса прогресса чтения вверху страницы. */
export function ReadingProgress() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      el.style.setProperty("--sp", String(max > 0 ? window.scrollY / max : 0));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div
      ref={ref}
      aria-hidden
      className="scroll-progress fixed inset-x-0 top-0 z-[60] h-[2px] bg-bronze"
    />
  );
}

/* Контекст «внутри тёмного лендинга» — на будущее (сейчас не используется
   логикой, оставлен намеренно простым). */
const LandingCtx = createContext(true);
export const useLanding = () => useContext(LandingCtx);
