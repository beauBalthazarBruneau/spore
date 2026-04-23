const path = require('path');

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  experimental: { serverComponentsExternalPackages: ["better-sqlite3"] },
  webpack: (config) => {
    config.externals = config.externals || [];
    config.externals.push({ "better-sqlite3": "commonjs better-sqlite3" });

    config.resolve.alias['@mycel'] = path.resolve(__dirname, '../mycel/index.ts');

    return config;
  },
};
