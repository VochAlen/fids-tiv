// vitest.config.ts
//
// NOVO (po zahtjevu — automatski testovi za kritičnu logiku, da
// spriječe tiho vraćanje već popravljenih bugova iz ove sesije).
// resolve.alias prati @/ iz tsconfig.json, da testovi mogu importovati
// isti lib/ kod koji koristi i sama aplikacija.
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', '.next'],
  },
});
