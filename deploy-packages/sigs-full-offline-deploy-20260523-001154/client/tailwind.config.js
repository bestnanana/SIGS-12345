/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ai: {
          primary: "#6C4CF1",
          bg: "#FAFAFC",
          card: "#FFFFFF",
          border: "#ECECF2",
          title: "#111111",
          body: "#666666",
          muted: "#8A8A93"
        },
        tsinghua: {
          50: "#f7f3ff",
          100: "#efe5ff",
          200: "#dfccff",
          300: "#c7a5ff",
          400: "#a873f6",
          500: "#8d49e8",
          600: "#742bcf",
          700: "#5e23ab",
          800: "#4f208c",
          900: "#3f1b70"
        }
      },
      boxShadow: {
        soft: "0 10px 30px rgba(63, 27, 112, 0.08)"
      }
    }
  },
  plugins: []
};
