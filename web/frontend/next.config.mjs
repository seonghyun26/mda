/** @type {import('next').NextConfig} */
const isDev = process.env.NEXT_DEV === "1";

const nextConfig = {
  // Static export for production (served by FastAPI).
  // Omitted in dev so Next.js hot-reload works normally.
  ...(!isDev && { output: "export", trailingSlash: true }),

  // In dev, proxy /api/* to the FastAPI backend on :8000.
  ...(isDev && {
    async rewrites() {
      return [{ source: "/api/:path*", destination: "http://localhost:8000/api/:path*" }];
    },
  }),
};

export default nextConfig;
