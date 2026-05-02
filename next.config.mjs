/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
    // @ffmpeg-installer and fluent-ffmpeg use dynamic requires that webpack
    // can't trace; treat them as runtime-only externals so Next.js loads them
    // straight from node_modules at request time.
    serverComponentsExternalPackages: [
      "@ffmpeg-installer/ffmpeg",
      "fluent-ffmpeg",
    ],
  },
};

export default nextConfig;
