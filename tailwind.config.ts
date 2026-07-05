import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Cormorant Garamond'", "Georgia", "serif"],
        sans: ["'Golos Text'", "system-ui", "sans-serif"],
      },
      colors: {
        ink: "#1a1a1a",
        muted: "#57534e",
        line: "#e5e2dc",
        paper: "#faf9f6",
        // Палитра «Свод» A: терракота + слива.
        accent: "#9c4a28",
        clientaccent: "#7a3a5a",
        // Кинематографичная тёмная палитра лендинга: уголь + слоновая кость +
        // бронза + приглушённая олива (см. components/landing/*).
        coal: "#14110d",
        coal2: "#1d1914",
        coal3: "#26211a",
        ivory: "#ece4d4",
        ivorymuted: "#a89e8c",
        bronze: "#c08b5c",
        bronzedeep: "#8f6039",
        olive: "#9aa07b",
        linedark: "rgba(236,228,212,0.14)",
      },
    },
  },
  plugins: [],
};

export default config;
