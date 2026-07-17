import type { Passport } from "@/lib/types";
import type { ComplexityLevel } from "./calc";

// Детерминированный вывод сложности проекта из паспорта — вместо захардкоженной
// «средней». Сигналы берём из объективных полей паспорта (перепланировка,
// хранение, число зон/санузлов, состояние объекта, разнородность стиля).
// Дизайнер видит результат в разбивке цены («Сложность стиля»).
export function deriveComplexity(passport: Passport): ComplexityLevel {
  const replanning = passport.object.replanning;
  const condition = passport.object.condition;
  const storage = passport.lifestyle.storage_pressure;
  const bathrooms = passport.lifestyle.bathrooms ?? 0;
  const zones = passport.rooms?.zones?.length ?? 0;
  const directions = passport.style.directions?.length ?? 0;

  // Признаки высокой сложности (каждый = +1).
  const highSignals = [
    replanning === "yes", // перепланировка/согласования
    condition === "shell", // объект в бетоне — больше работы
    storage === "high", // высокое давление на хранение → сложные системы
    zones >= 3, // много отдельных функциональных зон
    bathrooms >= 3, // много мокрых точек
    directions >= 3, // разнородный/эклектичный стиль
  ].filter(Boolean).length;

  if (highSignals >= 2) return "high";

  // Признаки простого проекта: ничего структурного, лёгкий быт.
  const simple =
    replanning !== "yes" &&
    condition !== "shell" &&
    storage === "low" &&
    zones <= 1 &&
    bathrooms <= 1;

  if (highSignals === 0 && simple) return "low";

  return "mid";
}
