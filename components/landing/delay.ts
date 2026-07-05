import type { CSSProperties } from "react";

// Каскадная задержка reveal-анимаций (--d читает .cine в globals.css).
// Лежит отдельно от cinema.tsx: это чистая функция, её зовут и серверные
// компоненты — из "use client"-модуля она пришла бы client-reference-прокси.
export function delay(i: number, step = 0.09): CSSProperties {
  return { "--d": `${(i * step).toFixed(2)}s` } as CSSProperties;
}
