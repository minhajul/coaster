/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        chunky: ['"Fredoka"', '"Comic Sans MS"', "system-ui", "sans-serif"],
      },
      colors: {
        cart: {
          red: "#ff4d4d",
          yellow: "#ffd633",
          blue: "#3da5ff",
          green: "#5cd66b",
          purple: "#b66bff",
        },
      },
      animation: {
        "pulse-slow": "pulse 1.5s ease-in-out infinite",
        wiggle: "wiggle 0.6s ease-in-out infinite",
      },
      keyframes: {
        wiggle: {
          "0%, 100%": { transform: "rotate(-3deg)" },
          "50%": { transform: "rotate(3deg)" },
        },
      },
    },
  },
  plugins: [
    // Pointer-based variants: a phone in landscape is wider than the
    // `md` breakpoint but still needs touch controls, so input UI is
    // switched on pointer type rather than viewport width.
    function ({ addVariant }) {
      addVariant("touch", "@media (pointer: coarse)");
      addVariant("mouse", "@media (pointer: fine), (pointer: none)");
    },
  ],
};
