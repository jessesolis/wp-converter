/** @type {import('next').NextConfig} */
const nextConfig = {
  // Dev-time proxy so the browser can hit `/api/*` without CORS.
  // In prod this is replaced by whatever reverse-proxy / deploy setup we land on.
  async rewrites() {
    const backend = process.env.BACKEND_URL ?? "http://localhost:3001";
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
