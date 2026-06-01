/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./client/index.html", "./client/src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // 清华大学品牌色系
        tsinghua: {
          50: "#f8f5ff",
          100: "#f0e8ff",
          200: "#e0d0ff",
          300: "#c9a8ff",
          400: "#ad75ff",
          500: "#9545ff",
          600: "#8620ff",
          700: "#730eeb",
          800: "#5f0ec5",
          900: "#4f0fa1",
          950: "#330066",
        },
        // 功能色
        ai: {
          primary: "#6C4CF1",
          "primary-hover": "#5A3BD9",
          "primary-light": "#EDE9FE",
          bg: "#F8F9FC",
          "bg-warm": "#FBF9FE",
          card: "#FFFFFF",
          "card-hover": "#FEFEFF",
          border: "#E8E5F0",
          "border-light": "#F0EDF7",
          title: "#1A1528",
          body: "#4A4558",
          muted: "#8B8698",
          "muted-light": "#B5B0C4",
          success: "#10B981",
          warning: "#F59E0B",
          error: "#EF4444",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "HarmonyOS Sans SC",
          "Microsoft YaHei",
          "PingFang SC",
          "Hiragino Sans GB",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        soft: "0 4px 24px rgba(108, 76, 241, 0.08)",
        "soft-lg": "0 12px 40px rgba(108, 76, 241, 0.12)",
        "soft-xl": "0 20px 60px rgba(108, 76, 241, 0.15)",
        card: "0 2px 12px rgba(0, 0, 0, 0.04), 0 1px 4px rgba(0, 0, 0, 0.02)",
        "card-hover": "0 8px 30px rgba(108, 76, 241, 0.10), 0 2px 8px rgba(0, 0, 0, 0.04)",
        button: "0 4px 16px rgba(108, 76, 241, 0.24)",
        "button-hover": "0 8px 24px rgba(108, 76, 241, 0.32)",
      },
      borderRadius: {
        "2xl": "16px",
        "3xl": "20px",
        "4xl": "24px",
      },
      animation: {
        "fade-in": "fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) both",
        "slide-up": "slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "slide-down": "slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1) both",
        "scale-in": "scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) both",
        shimmer: "shimmer 2s linear infinite",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        slideDown: {
          from: { opacity: "0", transform: "translateY(-8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        scaleIn: {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
};
