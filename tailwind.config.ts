import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        /** Primary canvas */
        page: "#0A0A0F",
        /** Elevated panels / form shell */
        surface: "#12121F",
        ink: {
          /** Legacy page bg — prefer `page` */
          900: "#08080F",
          /** Cards / panels */
          800: "#141420",
          700: "#252536",
          600: "#343448",
          500: "#6B7280",
          400: "#9CA3AF",
          300: "#D1D5DB",
          200: "#E5E7EB",
          /** Primary text */
          100: "#FAFAFA",
        },
        accent: {
          DEFAULT: "#7C3AED",
          muted: "#A78BFA",
        },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
