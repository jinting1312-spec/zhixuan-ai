import type { NextConfig } from 'next';
const config: NextConfig = { poweredByHeader: false, serverExternalPackages: [], turbopack: { root: process.cwd() } };
export default config;
