"use client";

// Шапка лендинга: фиксированная, стеклянная, с мобильным меню.
// Только MVP-разделы — никакого маркетплейса, каталогов и рейтингов.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ReadingProgress } from "./cinema";
import CursorGlow from "./cursor-glow";
import LanguageSwitcher from "./language-switcher";
import { usePublicLocale } from "@/lib/i18n/public";

export default function LandingNav() {
  const { dictionary } = usePublicLocale();
  const n = dictionary.nav;
  const links: Array<[string, string]> = [
    [n.designers, "/designers"],
    [n.studios, "/studios"],
    [n.demoBrief, "/demo/brief"],
    [n.demoProposal, "/demo/proposal"],
  ];
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <CursorGlow />
      <ReadingProgress />
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-colors duration-500 ${
          scrolled ? "border-b border-linedark bg-coal/85 backdrop-blur-md" : "bg-transparent"
        }`}
      >
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-6 px-5 md:px-8">
          <Link href="/" className="flex items-center gap-3" onClick={() => setOpen(false)}>
            <span className="font-display text-[22px] font-semibold tracking-[0.02em] text-ivory">
              {dictionary.app.name}
            </span>
            <span className="hidden rounded-full border border-bronze/35 bg-bronze/10 px-3 py-1.5 text-[12px] font-medium tracking-[0.08em] text-bronze lg:inline">
              {dictionary.app.tagline}
            </span>
          </Link>

          <nav className="hidden items-center gap-6 xl:flex" aria-label="Основная навигация">
            {links.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className="text-[13.5px] text-ivorymuted transition-colors hover:text-ivory"
              >
                {label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden sm:block">
              <LanguageSwitcher />
            </div>
            <Link href="/login" className="hidden text-[13.5px] text-ivorymuted hover:text-ivory sm:inline">
              {n.login}
            </Link>
            <Link href="/login" className="btn-bronze !min-h-10 whitespace-nowrap !px-3 !py-2 !text-[14px] sm:!px-5 sm:!text-[15px]">
              {n.createProject}
            </Link>
            <button
              onClick={() => setOpen(!open)}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-linedark text-ivory xl:hidden"
              aria-label={open ? n.close : n.menu}
              aria-expanded={open}
            >
              <span className="relative block h-[10px] w-[18px]">
                <span
                  className={`absolute left-0 top-0 h-[1.5px] w-full bg-ivory transition-transform ${open ? "translate-y-[4.5px] rotate-45" : ""}`}
                />
                <span
                  className={`absolute bottom-0 left-0 h-[1.5px] w-full bg-ivory transition-transform ${open ? "-translate-y-[4px] -rotate-45" : ""}`}
                />
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Мобильное меню */}
      {open && (
        <div className="fixed inset-0 z-40 flex flex-col bg-coal/97 px-6 pb-10 pt-24 backdrop-blur-xl xl:hidden">
          <nav className="flex flex-col gap-1" aria-label="Мобильная навигация">
            {links.map(([label, href], i) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className="animate-rise border-b border-linedark py-4 font-display text-[26px] text-ivory"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="mt-auto flex flex-col gap-3 pt-8">
            <div className="mb-2">
              <LanguageSwitcher />
            </div>
            <Link href="/login" onClick={() => setOpen(false)} className="btn-bronze w-full">
              {n.createProject}
            </Link>
            <Link href="/login" onClick={() => setOpen(false)} className="btn-dark-ghost w-full">
              {n.login}
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
