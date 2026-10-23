import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify('test') },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Datas locais: os testes rodam no fuso de São Paulo, o mesmo da maior parte dos usuários.
    env: { TZ: 'America/Sao_Paulo' },
    restoreMocks: true,
  },
});
