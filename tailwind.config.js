/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./client/index.html", "./client/src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
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
