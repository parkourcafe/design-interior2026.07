import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#1a1a1a",
        muted: "#6b6b6b",
        line: "#e5e2dc",
        paper: "#faf9f6",
        accent: "#3d5a45",
        clientaccent: "#3a5a7a",
      },
    },
  },
  plugins: [],
};

export default config;
