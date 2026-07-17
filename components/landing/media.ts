// Медиа лендинга: кинематографичные ассеты, сгенерированные под задачу
// (Higgsfield: Cinema Studio Video 3.0 — видео, Nano Banana — изображения).
// По умолчанию — CDN. Для самостоятельного хостинга: `npm run fetch:media`
// (скачает файлы в public/landing) и NEXT_PUBLIC_MEDIA_BASE=/landing.

const CDN = "https://d8j0ntlcm91z4.cloudfront.net/user_3EKntK4EDjG8nay4H1dy1TK30mB";
const BASE = process.env.NEXT_PUBLIC_MEDIA_BASE || CDN;

const f = (name: string) => `${BASE}/${name}`;

export const MEDIA = {
  // Герой: полноэкранное видео + постер-фолбэк (обязателен для reduced motion).
  heroVideo: f("hf_20260705_184919_908ad4e0-2ddb-4200-9547-44b6e620f949.mp4"),
  heroPoster: f("hf_20260705_184650_ee7f3b53-914d-4c16-9ec0-a557dc063088.png"),
  // Туман → структура (секция 2).
  fog: f("hf_20260705_184717_73928609-5d8c-4aa6-8096-7685d340a80f.png"),
  // Паспорт проекта — центральный 3D-объект sticky-секции (4:5).
  passport: f("hf_20260705_184733_d3f69bfc-cf1d-4e47-b4e8-cbb6ba7eeb2b.png"),
  // Риск-карточки вокруг плана.
  risks: f("hf_20260705_184735_1bbe87cf-1190-4df9-be64-6a3a190e5937.png"),
  // КП собирается из блоков.
  proposal: f("hf_20260705_184906_3f22541b-be52-4396-af0a-e303f271df14.png"),
  // Review Board дизайнера.
  review: f("hf_20260705_184924_1d7e2d92-30ab-44dd-9502-46598fa4d369.png"),
  // Клиентский бриф (десктоп + телефон).
  clientBrief: f("hf_20260705_184929_3dcffd26-a517-47c4-bd21-94f11f52cf66.png"),
  // Pricing logic.
  pricing: f("hf_20260705_184935_f075f3be-c2c8-49ed-be61-5ef46c7d7647.png"),
  // Одна ссылка — один дизайнер (доверие, без маркетплейса).
  ownership: f("hf_20260705_184938_fecfdc7b-3289-4b96-8142-0de042e79e6b.png"),
  // Данные в тишине (privacy).
  safety: f("hf_20260705_184942_a268db01-67b8-4116-a5e6-5978c9cf2fbf.png"),
  // Повестка первой встречи.
  agenda: f("hf_20260705_184947_9090187b-f7ee-420e-8f2d-fe96d2ca4718.png"),
} as const;
