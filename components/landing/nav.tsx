"use client";

// Шапка лендинга: фиксированная, стеклянная, с мобильным меню.
// Только MVP-разделы — никакого маркетплейса, каталогов и рейтингов.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import { ReadingProgress } from "./cinema";

const n = ru.landing.nav;

const LINKS: Array<[string, string]> = [
  [n.designers, "/designers"],
  [n.studios, "/studios"],
  [n.how, "/#how"],
  [n.demoBrief, "/demo/brief"],
  [n.demoProposal, "/demo/proposal"],
  [n.pilot, "/pilot"],
  [n.security, "/security"],
  [n.contacts, "/pilot#request"],
];

export default function LandingNav() {
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
      <ReadingProgress />
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-colors duration-500 ${
          scrolled ? "border-b border-linedark bg-coal/85 backdrop-blur-md" : "bg-transparent"
        }`}
      >
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-6 px-5 md:px-8">
          <Link href="/" className="flex items-baseline gap-3" onClick={() => setOpen(false)}>
            <span className="font-display text-[22px] font-semibold tracking-[0.02em] text-ivory">
              {ru.app.name}
            </span>
            <span className="hidden text-[10px] uppercase tracking-[0.22em] text-ivorymuted lg:inline">
              {ru.app.tagline}
            </span>
          </Link>

          <nav className="hidden items-center gap-6 xl:flex" aria-label="Основная навигация">
            {LINKS.map(([label, href]) => (
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
            <Link href="/login" className="hidden text-[13.5px] text-ivorymuted hover:text-ivory sm:inline">
              {n.login}
            </Link>
            <Link href="/login" className="btn-bronze !min-h-10 !px-4 !py-2 !text-[13.5px]">
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
            {LINKS.map(([label, href], i) => (
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
