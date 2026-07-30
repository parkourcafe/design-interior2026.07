"use client";

import { useEffect, useState } from "react";
import { ru } from "@/lib/i18n/ru";

export const PUBLIC_LOCALES = ["ru", "en", "id", "es", "fr", "de", "pt", "it", "ar", "zh", "ja", "ko"] as const;
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

type EnglishPublic = typeof en;
type PublicOverrides = {
  app: EnglishPublic["app"];
  nav: Partial<EnglishPublic["nav"]>;
  hero: Partial<EnglishPublic["hero"]>;
  footer: Partial<EnglishPublic["footer"]>;
};

function fromEnglish(overrides: PublicOverrides): EnglishPublic {
  return {
    app: overrides.app,
    nav: { ...en.nav, ...overrides.nav },
    hero: { ...en.hero, ...overrides.hero },
    footer: { ...en.footer, ...overrides.footer },
  };
}

const es = fromEnglish({
  app: { name: "RemHaOS", tagline: "Sistema operativo para proyectos de interiorismo" },
  nav: { designers: "Para diseñadores", studios: "Para estudios", how: "Cómo funciona", demoBrief: "Demo del brief", demoProposal: "Demo de propuesta", pilot: "Piloto", security: "Seguridad", contacts: "Contactos", createProject: "Crear proyecto", login: "Entrar", menu: "Menú", close: "Cerrar" },
  hero: { eyebrow: "Del caos al orden", positioning: "Sistema operativo para proyectos de interiorismo", boundary: "Ya disponible: el primer flujo de trabajo, desde el brief del cliente hasta una propuesta revisada.", sub: "Conecta al cliente, al diseñador, al arquitecto y al equipo de obra. Organiza todo el recorrido en un único sistema donde no se pierde ninguna decisión.", cta1: "Ver cómo funciona RemHaOS", roleLabel: "Elige tu perfil", cta2: "Soy diseñador", cta3: "Represento a un estudio", trust: "Cliente sin registro · el diseñador mantiene el control · sin marketplace" },
  footer: { tagline: "El sistema operativo para un proyecto de interiorismo.", product: "Producto", company: "Confianza", legalPrivacy: "Privacidad", legalTerms: "Condiciones", support: "Soporte", pilotNote: "La versión 1.0 es gratuita, sin pagos ni suscripciones.", rights: "Vista internacional · interfaz en español" },
});

const fr = fromEnglish({
  app: { name: "RemHaOS", tagline: "Système d’exploitation pour les projets d’intérieur" },
  nav: { designers: "Pour les designers", studios: "Pour les studios", how: "Fonctionnement", demoBrief: "Démo du brief", demoProposal: "Démo de l’offre", pilot: "Pilote", security: "Sécurité", contacts: "Contacts", createProject: "Créer un projet", login: "Connexion", menu: "Menu", close: "Fermer" },
  hero: { eyebrow: "Du chaos à l’ordre", positioning: "Système d’exploitation pour les projets d’intérieur", boundary: "Disponible dès maintenant : du brief client à une proposition vérifiée.", sub: "Relie le client, le designer, l’architecte et l’équipe de chantier. Tout le parcours est organisé dans un seul système où aucune décision ne se perd.", cta1: "Découvrir RemHaOS", roleLabel: "Choisissez votre profil", cta2: "Je suis designer", cta3: "Je représente un studio", trust: "Client sans inscription · contrôle conservé par le designer · sans marketplace" },
  footer: { tagline: "Le système d’exploitation du projet d’intérieur.", product: "Produit", company: "Confiance", legalPrivacy: "Confidentialité", legalTerms: "Conditions", support: "Assistance", pilotNote: "La version 1.0 est gratuite, sans paiement ni abonnement.", rights: "Aperçu international · interface en français" },
});

const de = fromEnglish({
  app: { name: "RemHaOS", tagline: "Betriebssystem für Innenraumprojekte" },
  nav: { designers: "Für Designer", studios: "Für Studios", how: "So funktioniert es", demoBrief: "Briefing-Demo", demoProposal: "Angebots-Demo", pilot: "Pilot", security: "Sicherheit", contacts: "Kontakt", createProject: "Projekt erstellen", login: "Anmelden", menu: "Menü", close: "Schließen" },
  hero: { eyebrow: "Vom Chaos zur Ordnung", positioning: "Betriebssystem für Innenraumprojekte", boundary: "Jetzt verfügbar: vom Kundenbriefing bis zum geprüften Angebot.", sub: "Verbindet Auftraggeber, Designer, Architekt und Bauteam. Der gesamte Weg wird in einem System geordnet, in dem keine Entscheidung verloren geht.", cta1: "RemHaOS kennenlernen", roleLabel: "Wählen Sie Ihr Profil", cta2: "Ich bin Designer", cta3: "Ich vertrete ein Studio", trust: "Kunde ohne Registrierung · Designer behalten die Kontrolle · kein Marktplatz" },
  footer: { tagline: "Das Betriebssystem für Innenraumprojekte.", product: "Produkt", company: "Vertrauen", legalPrivacy: "Datenschutz", legalTerms: "Bedingungen", support: "Support", pilotNote: "Version 1.0 ist kostenlos, ohne Zahlungen oder Abonnements.", rights: "Internationale Vorschau · deutsche Oberfläche" },
});

const pt = fromEnglish({
  app: { name: "RemHaOS", tagline: "Sistema operacional para projetos de interiores" },
  nav: { designers: "Para designers", studios: "Para estúdios", how: "Como funciona", demoBrief: "Demo do briefing", demoProposal: "Demo da proposta", pilot: "Piloto", security: "Segurança", contacts: "Contatos", createProject: "Criar projeto", login: "Entrar", menu: "Menu", close: "Fechar" },
  hero: { eyebrow: "Do caos à ordem", positioning: "Sistema operacional para projetos de interiores", boundary: "Já disponível: do briefing do cliente à proposta revisada.", sub: "Conecta cliente, designer, arquiteto e equipe de obra. Toda a jornada fica organizada em um único sistema onde nenhuma decisão se perde.", cta1: "Conhecer o RemHaOS", roleLabel: "Escolha seu perfil", cta2: "Sou designer", cta3: "Represento um estúdio", trust: "Cliente sem cadastro · designer mantém o controle · sem marketplace" },
  footer: { tagline: "O sistema operacional para projetos de interiores.", product: "Produto", company: "Confiança", legalPrivacy: "Privacidade", legalTerms: "Termos", support: "Suporte", pilotNote: "A versão 1.0 é gratuita, sem pagamentos ou assinaturas.", rights: "Prévia internacional · interface em português" },
});

const it = fromEnglish({
  app: { name: "RemHaOS", tagline: "Sistema operativo per progetti d’interni" },
  nav: { designers: "Per designer", studios: "Per studi", how: "Come funziona", demoBrief: "Demo brief", demoProposal: "Demo proposta", pilot: "Pilota", security: "Sicurezza", contacts: "Contatti", createProject: "Crea progetto", login: "Accedi", menu: "Menu", close: "Chiudi" },
  hero: { eyebrow: "Dal caos all’ordine", positioning: "Sistema operativo per progetti d’interni", boundary: "Già disponibile: dal brief del cliente alla proposta verificata.", sub: "Collega cliente, designer, architetto e squadra di cantiere. L’intero percorso è organizzato in un unico sistema dove nessuna decisione va persa.", cta1: "Scopri RemHaOS", roleLabel: "Scegli il tuo profilo", cta2: "Sono un designer", cta3: "Rappresento uno studio", trust: "Cliente senza registrazione · controllo al designer · nessun marketplace" },
  footer: { tagline: "Il sistema operativo per il progetto d’interni.", product: "Prodotto", company: "Fiducia", legalPrivacy: "Privacy", legalTerms: "Termini", support: "Assistenza", pilotNote: "La versione 1.0 è gratuita, senza pagamenti o abbonamenti.", rights: "Anteprima internazionale · interfaccia in italiano" },
});

const ar = fromEnglish({
  app: { name: "RemHaOS", tagline: "نظام تشغيل لمشاريع التصميم الداخلي" },
  nav: { designers: "للمصممين", studios: "للاستوديوهات", how: "كيف يعمل", demoBrief: "عرض موجز", demoProposal: "عرض المقترح", pilot: "تجريبي", security: "الأمان", contacts: "التواصل", createProject: "إنشاء مشروع", login: "تسجيل الدخول", menu: "القائمة", close: "إغلاق" },
  hero: { eyebrow: "من الفوضى إلى النظام", positioning: "نظام تشغيل لمشاريع التصميم الداخلي", boundary: "متاح الآن: من موجز العميل إلى مقترح تمت مراجعته.", sub: "يربط العميل والمصمم والمهندس المعماري وفريق التنفيذ، وينظم الرحلة كاملة في نظام واحد لا تضيع فيه القرارات.", cta1: "اكتشف RemHaOS", roleLabel: "اختر دورك", cta2: "أنا مصمم", cta3: "أمثل استوديو", trust: "العميل بلا تسجيل · المصمم يحتفظ بالتحكم · بلا سوق وسطاء" },
  footer: { tagline: "نظام التشغيل لمشروع التصميم الداخلي.", product: "المنتج", company: "الثقة", legalPrivacy: "الخصوصية", legalTerms: "الشروط", support: "الدعم", pilotNote: "الإصدار 1.0 مجاني بلا مدفوعات أو اشتراكات.", rights: "معاينة دولية · واجهة عربية" },
});

const zh = fromEnglish({
  app: { name: "RemHaOS", tagline: "室内项目操作系统" },
  nav: { designers: "设计师", studios: "设计工作室", how: "工作方式", demoBrief: "需求简报演示", demoProposal: "方案演示", pilot: "试用计划", security: "安全", contacts: "联系", createProject: "创建项目", login: "登录", menu: "菜单", close: "关闭" },
  hero: { eyebrow: "从混乱到有序", positioning: "室内项目操作系统", boundary: "现已开放：从客户需求简报到审核后的商业方案。", sub: "连接客户、设计师、建筑师与施工团队，把整个项目过程整理到一个系统中，让每一个决定都有迹可循。", cta1: "了解 RemHaOS", roleLabel: "选择您的身份", cta2: "我是设计师", cta3: "我代表设计工作室", trust: "客户无需注册 · 设计师保持控制 · 不做中介平台" },
  footer: { tagline: "室内项目的操作系统。", product: "产品", company: "信任", legalPrivacy: "隐私", legalTerms: "条款", support: "支持", pilotNote: "1.0 版本免费，无付款或订阅。", rights: "国际预览 · 中文界面" },
});

const ja = fromEnglish({
  app: { name: "RemHaOS", tagline: "インテリアプロジェクトのオペレーティングシステム" },
  nav: { designers: "デザイナー向け", studios: "スタジオ向け", how: "仕組み", demoBrief: "ブリーフのデモ", demoProposal: "提案書のデモ", pilot: "パイロット", security: "セキュリティ", contacts: "お問い合わせ", createProject: "プロジェクトを作成", login: "ログイン", menu: "メニュー", close: "閉じる" },
  hero: { eyebrow: "混乱から秩序へ", positioning: "インテリアプロジェクトのオペレーティングシステム", boundary: "現在利用可能：クライアントブリーフから確認済み提案書まで。", sub: "クライアント、デザイナー、建築家、施工チームをつなぎ、すべての判断を失わない一つのシステムにまとめます。", cta1: "RemHaOS の仕組みを見る", roleLabel: "あなたの立場を選択", cta2: "デザイナーです", cta3: "スタジオを代表します", trust: "クライアント登録不要 · デザイナーが管理 · マーケットプレイスなし" },
  footer: { tagline: "インテリアプロジェクトのオペレーティングシステム。", product: "製品", company: "信頼", legalPrivacy: "プライバシー", legalTerms: "利用規約", support: "サポート", pilotNote: "バージョン1.0は無料で、支払いや購読はありません。", rights: "国際プレビュー · 日本語インターフェース" },
});

const ko = fromEnglish({
  app: { name: "RemHaOS", tagline: "인테리어 프로젝트 운영 시스템" },
  nav: { designers: "디자이너용", studios: "스튜디오용", how: "작동 방식", demoBrief: "브리프 데모", demoProposal: "제안서 데모", pilot: "파일럿", security: "보안", contacts: "연락처", createProject: "프로젝트 만들기", login: "로그인", menu: "메뉴", close: "닫기" },
  hero: { eyebrow: "혼돈에서 질서로", positioning: "인테리어 프로젝트 운영 시스템", boundary: "현재 이용 가능: 고객 브리프부터 검토된 제안서까지.", sub: "고객, 디자이너, 건축가와 시공팀을 연결하고 모든 결정을 하나의 체계 안에 정리합니다.", cta1: "RemHaOS 작동 방식 보기", roleLabel: "역할을 선택하세요", cta2: "디자이너입니다", cta3: "스튜디오를 대표합니다", trust: "고객 가입 불필요 · 디자이너가 통제 · 마켓플레이스 없음" },
  footer: { tagline: "인테리어 프로젝트를 위한 운영 시스템.", product: "제품", company: "신뢰", legalPrivacy: "개인정보", legalTerms: "이용약관", support: "지원", pilotNote: "버전 1.0은 결제나 구독 없이 무료입니다.", rights: "국제 미리보기 · 한국어 인터페이스" },
});

const ruPublic = {
  app: { name: ru.app.name, tagline: ru.app.tagline },
  nav: ru.landing.nav,
  hero: ru.landing.hero,
  footer: ru.landing.footer,
};

export const publicDictionaries = { ru: ruPublic, en, id, es, fr, de, pt, it, ar, zh, ja, ko };
export type PublicDictionary = (typeof publicDictionaries)["ru"];

function detectLocale(): PublicLocale {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored && PUBLIC_LOCALES.includes(stored as PublicLocale)) return stored as PublicLocale;
  const language = navigator.language.toLowerCase();
  const primary = language.split("-")[0] as PublicLocale;
  if (PUBLIC_LOCALES.includes(primary)) return primary;
  return "ru";
}

export function setPublicLocale(locale: PublicLocale) {
  window.localStorage.setItem(STORAGE_KEY, locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: locale }));
}

export function usePublicLocale() {
  const [locale, setLocale] = useState<PublicLocale>("ru");

  useEffect(() => {
    const detected = detectLocale();
    setLocale(detected);
    document.documentElement.lang = detected;
    document.documentElement.dir = detected === "ar" ? "rtl" : "ltr";
    const onChange = (event: Event) => setLocale((event as CustomEvent<PublicLocale>).detail);
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, []);

  return { locale, dictionary: publicDictionaries[locale], setLocale: setPublicLocale };
}
