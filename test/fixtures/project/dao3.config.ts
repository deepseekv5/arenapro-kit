import type { IDao3Config } from 'vite-plugin-arenapro-script';

export default {
  bundles: {
    bundle: {
      client: { entry: 'App.ts' },
      server: { entry: 'App.ts' },
      enable: true,
    },
  },
} as IDao3Config;
