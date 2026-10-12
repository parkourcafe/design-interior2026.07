import type { DesignerPublic } from "@/lib/designer";
import { ru } from "@/lib/i18n/ru";

const t = ru.designerCard;

function telegramHref(t: string): string {
  const handle = t.replace(/^@/, "").replace(/^https?:\/\/t\.me\//, "");
  return `https://t.me/${handle}`;
}
function instagramHref(t: string): string {
  const handle = t.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "");
  return `https://instagram.com/${handle}`;
}
function normalizeUrl(u: string): string {
  return /^https?:\/\//.test(u) ? u : `https://${u}`;
}

// Карточка «от кого пришёл бриф» — клиент видит дизайнера, соцсети, контакты.
export default function DesignerCard({ designer, preview = false }: { designer: DesignerPublic; preview?: boolean }) {
  const { name, studio_name, email, profile } = designer;
  // Заголовок — имя или студия. Если оба пусты — нейтральное название, а не
  // email: адрес остаётся отдельным контактом ниже (ТЗ 08.10, FIX-04 P2).
  const title = name?.trim() || studio_name?.trim() || "";
  const contactEmail = profile.email || email;

  return (
    <div className="rounded-xl border border-line bg-white p-5">
      <p className="text-xs uppercase tracking-widest text-muted">{t.eyebrow}</p>
      <div className="mt-1">
        <p className={title ? "text-lg font-semibold" : "text-lg font-semibold text-ink/70"} data-testid="designer-card-title">
          {title || t.untitled}
        </p>
        {studio_name && name && <p className="text-sm text-muted">{studio_name}</p>}
        {!title && preview && <p className="mt-1 text-xs text-muted">{t.untitledPreview}</p>}
      </div>
      {profile.about && <p className="mt-2 text-sm text-ink/80">{profile.about}</p>}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {profile.phone && <span className="text-muted">{profile.phone}</span>}
        {contactEmail && (
          <a href={`mailto:${contactEmail}`} className="inline-flex min-h-11 items-center text-accent">
            {contactEmail}
          </a>
        )}
        {profile.instagram && (
          <a href={instagramHref(profile.instagram)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-accent">
            Instagram
          </a>
        )}
        {profile.telegram && (
          <a href={telegramHref(profile.telegram)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-accent">
            Telegram
          </a>
        )}
        {profile.website && (
          <a href={normalizeUrl(profile.website)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-accent">
            {t.website}
          </a>
        )}
      </div>
    </div>
  );
}
