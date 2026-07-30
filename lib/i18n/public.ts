"use client";

import { useEffect, useState } from "react";
import { ru } from "@/lib/i18n/ru";

export const PUBLIC_LOCALES = ["ru", "en", "id"] as const;
export type PublicLocale = (typeof PUBLIC_LOCALES)[number];

const STORAGE_KEY = "remhaos-locale";
const CHANGE_EVENT = "remhaos:locale-change";

const en = {
  app: {
    name: "RemHaOS",
    tagline: "Operating system for interior projects",
  },
  nav: {
    designers: "For designers",
    studios: "For studios",
    how: "How it works",
    demoBrief: "Brief demo",
    demoProposal: "Proposal demo",
    pilot: "Pilot",
    security: "Security",
    contacts: "Contacts",
    createProject: "Create project",
    login: "Sign in",
    menu: "Menu",
    close: "Close",
  },
  hero: {
    eyebrow: "From chaos to order",
    h1: "RemHaOS",
    positioning: "Operating system for interior projects",
    boundary: "Available now: the first working workflow, from the client brief to a reviewed proposal.",
    sub: "Connects the client, designer, architect and construction team. It turns the entire journey—from the first request to project handover—into one clear system where no decision gets lost.",
    cta1: "See how RemHaOS works",
    roleLabel: "Choose your path",
    cta2: "I am a designer",
    cta3: "I represent a studio",
    trust: "No client registration · designers stay in control · no marketplace or lead diversion",
    fog: [
      "“cosy, but contemporary”",
      "“premium, but not flashy”",
      "“Italian in spirit, practical in use”",
      "“fast, but with custom furniture”",
      "“I do not understand the budget yet”",
    ],
    card1: {
      title: "Project: 120 m² apartment",
      rows: ["Brief completed", "Project passport ready", "5 risks identified", "Price calculated by studio rules", "Proposal ready for review"],
      nextLabel: "Next action",
      next: "Review risks before the first meeting",
      cta: "Open review board",
    },
    card2: {
      tag: "Risk · budget / timeline",
      evidenceLabel: "Evidence",
      evidence: "“120 m², budget 1.5–3.5M ₽, timeline 3–4 months”",
      impactLabel: "What it affects",
      impact: "Clarify the finish level, procurement scope and timeline feasibility",
      confidenceLabel: "Confidence",
      confidence: "High",
      accept: "Accept risk",
      reject: "Reject",
    },
    card3: {
      title: "Commercial proposal",
      packageLabel: "Package",
      package: "Full interior design",
      priceLabel: "Price",
      price: "240,000–360,000 ₽",
      statusLabel: "Status",
      status: "Draft, designer review required",
      cta: "Send to client",
    },
    demoNote: "Card data is for demonstration",
  },
  footer: {
    tagline: "The operating system for an interior project. The first available workflow runs from brief to proposal.",
    product: "Product",
    company: "Trust",
    legalPrivacy: "Privacy",
    legalTerms: "Terms",
    support: "Support",
    pilotNote: "Version 1.0 is free: no payments, subscriptions or external purchase methods.",
    rights: "International preview · English interface",
  },
};

const id = {
  app: {
    name: "RemHaOS",
    tagline: "Sistem operasi untuk proyek interior",
  },
  nav: {
    designers: "Untuk desainer",
    studios: "Untuk studio",
    how: "Cara kerja",
    demoBrief: "Demo brief",
    demoProposal: "Demo proposal",
    pilot: "Program pilot",
    security: "Keamanan",
    contacts: "Kontak",
    createProject: "Buat proyek",
    login: "Masuk",
    menu: "Menu",
    close: "Tutup",
  },
  hero: {
    eyebrow: "Dari kekacauan menuju keteraturan",
    h1: "RemHaOS",
    positioning: "Sistem operasi untuk proyek interior",
    boundary: "Sudah tersedia: alur kerja pertama, dari brief klien hingga proposal yang telah ditinjau.",
    sub: "Menghubungkan klien, desainer, arsitek, dan tim konstruksi. Seluruh perjalanan—dari permintaan pertama hingga serah terima—tersusun dalam satu sistem agar tidak ada keputusan yang hilang.",
    cta1: "Lihat cara kerja RemHaOS",
    roleLabel: "Pilih kebutuhan Anda",
    cta2: "Saya seorang desainer",
    cta3: "Saya mewakili studio",
    trust: "Klien tanpa registrasi · desainer tetap memegang kendali · tanpa marketplace atau pengalihan prospek",
    fog: [
      "“nyaman, tetapi tetap modern”",
      "“terlihat premium, tetapi tidak berlebihan”",
      "“bergaya Italia, tetapi tetap praktis”",
      "“cepat, tetapi dengan furnitur khusus”",
      "“saya belum memahami anggarannya”",
    ],
    card1: {
      title: "Proyek: Apartemen 120 m²",
      rows: ["Brief selesai", "Paspor proyek siap", "5 risiko ditemukan", "Harga dihitung sesuai aturan studio", "Proposal siap ditinjau"],
      nextLabel: "Langkah berikutnya",
      next: "Tinjau risiko sebelum pertemuan pertama",
      cta: "Buka papan tinjauan",
    },
    card2: {
      tag: "Risiko · anggaran / jadwal",
      evidenceLabel: "Dasar",
      evidence: "“120 m², anggaran 1,5–3,5 juta ₽, waktu 3–4 bulan”",
      impactLabel: "Dampak",
      impact: "Perlu memperjelas tingkat finishing, lingkup pengadaan, dan kelayakan jadwal",
      confidenceLabel: "Tingkat keyakinan",
      confidence: "Tinggi",
      accept: "Terima risiko",
      reject: "Tolak",
    },
    card3: {
      title: "Proposal komersial",
      packageLabel: "Paket",
      package: "Desain interior lengkap",
      priceLabel: "Biaya",
      price: "240.000–360.000 ₽",
      statusLabel: "Status",
      status: "Draf, perlu ditinjau desainer",
      cta: "Kirim ke klien",
    },
    demoNote: "Data pada kartu hanya untuk demonstrasi",
  },
  footer: {
    tagline: "Sistem operasi untuk proyek interior. Alur pertama yang tersedia mencakup proses dari brief hingga proposal.",
    product: "Produk",
    company: "Kepercayaan",
    legalPrivacy: "Privasi",
    legalTerms: "Ketentuan",
    support: "Dukungan",
    pilotNote: "Versi 1.0 gratis: tanpa pembayaran, langganan, atau metode pembelian eksternal.",
    rights: "Pratinjau Indonesia · antarmuka Bahasa Indonesia",
  },
};

const ruPublic = {
  app: { name: ru.app.name, tagline: ru.app.tagline },
  nav: ru.landing.nav,
  hero: ru.landing.hero,
  footer: ru.landing.footer,
};

export const publicDictionaries = { ru: ruPublic, en, id };
export type PublicDictionary = (typeof publicDictionaries)["ru"];

function detectLocale(): PublicLocale {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored && PUBLIC_LOCALES.includes(stored as PublicLocale)) return stored as PublicLocale;
  const language = navigator.language.toLowerCase();
  if (language.startsWith("id")) return "id";
  if (language.startsWith("en")) return "en";
  return "ru";
}

export function setPublicLocale(locale: PublicLocale) {
  window.localStorage.setItem(STORAGE_KEY, locale);
  document.documentElement.lang = locale;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: locale }));
}

export function usePublicLocale() {
  const [locale, setLocale] = useState<PublicLocale>("ru");

  useEffect(() => {
    const detected = detectLocale();
    setLocale(detected);
    document.documentElement.lang = detected;
    const onChange = (event: Event) => setLocale((event as CustomEvent<PublicLocale>).detail);
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);

  return { locale, dictionary: publicDictionaries[locale], setLocale: setPublicLocale };
}
