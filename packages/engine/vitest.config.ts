import { defineConfig } from 'vitest/config';

// the oracle test runs thousands of random projects; CI machines are slower than laptops
export default defineConfig({ test: { testTimeout: 60_000 } });
