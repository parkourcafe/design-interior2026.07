import { pageMetadata } from "@/lib/seo";
import LandingNav from "@/components/landing/nav";
import LandingFooter from "@/components/landing/footer";
import DemoWizard from "./demo-wizard";

export const metadata = pageMetadata({
  title: "Бриф для дизайнера интерьера онлайн",
  description:
    "Отправьте клиенту ссылку — он заполнит бриф сам, а ArhiDom соберёт паспорт проекта и риски. Бесплатно в пилоте.",
  path: "/demo/brief",
});

// Демо-бриф: открывается без регистрации, помечен как демо, ничего не
// отправляет. Настоящий бриф создаётся кнопкой на финальном экране.
export default function DemoBriefPage() {
  return (
    <div className="landing min-h-screen">
      <LandingNav />
      <main className="glow-amber relative px-5 pb-24 pt-32 md:px-8">
        <div className="grid-arch pointer-events-none absolute inset-0 opacity-40" aria-hidden />
        <div className="relative">
          <DemoWizard />
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
