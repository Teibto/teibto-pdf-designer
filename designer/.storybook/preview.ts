/** @type { import('@storybook/web-components').Preview } */
const preview = {
  parameters: {
    backgrounds: {
      options: {
        dark: { name: 'dark', value: '#12131d' },
        light: { name: 'light', value: '#ffffff' },
      },
    },
  },
  initialGlobals: { backgrounds: { value: 'dark' } },
};

export default preview;
