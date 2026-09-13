/** @type { import('@storybook/web-components').Preview } */
const preview = {
  parameters: {
    backgrounds: {
      options: {
        dark: { name: 'dark', value: '#12131d' },
        light: { name: 'Oracle Redwood', value: '#f5f4f2' },
      },
    },
  },
  initialGlobals: { backgrounds: { value: 'light' } },
};

export default preview;
