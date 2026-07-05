import type { DesignerPublic } from "@/lib/designer";

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
export default function DesignerCard({ designer }: { designer: DesignerPublic }) {
  const { name, studio_name, email, profile } = designer;
  // Всегда показываем, от кого бриф: имя/студия, иначе — email как fallback.
  const title = name || studio_name || email;
  const contactEmail = profile.email || email;

  return (
    <div className="rounded-xl border border-line bg-white p-5">
      <p className="text-xs uppercase tracking-widest text-muted">Бриф от дизайнера</p>
      <div className="mt-1">
        {title && <p className="text-lg font-semibold">{title}</p>}
        {studio_name && name && <p className="text-sm text-muted">{studio_name}</p>}
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
            Сайт
          </a>
        )}
      </div>
    </div>
  );
}
