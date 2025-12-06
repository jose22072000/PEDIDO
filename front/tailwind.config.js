import {heroui} from "@heroui/theme"

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}",
    //'./src/styles/components/**/*.{css,scss}',
  ],
  theme: {
    extend: {},
  },
  darkMode: "class",
  plugins: [heroui({
      themes: {
        light: {
          colors: {
            primary: {              
              foreground: "#FFFFFF",
              DEFAULT: "#054C74",
            },            
          },
        },
        dark: {
          colors: {
            primary: {              
              foreground: "#FFFFFF",
              DEFAULT: "#054C74",
            },            
          },
        }
      },
    })],
}
