/** @type { import('@storybook/web-components').Preview } */
const preview = {
  parameters: {
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#12131d' },
        { name: 'light', value: '#ffffff' },
      ],
    },
  },
};

export default preview;
