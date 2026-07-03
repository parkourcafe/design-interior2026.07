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
      },
    },
  },
  plugins: [],
};

export default config;
