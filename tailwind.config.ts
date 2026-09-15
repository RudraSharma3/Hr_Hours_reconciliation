import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#d9e6ff',
          500: '#3b5bdb',
          600: '#2f4bc0',
          700: '#293fa0',
        },
      },
    },
  },
  plugins: [],
};

export default config;
