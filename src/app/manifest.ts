import type { MetadataRoute } from "next";

// Install / home-screen metadata. Icons are the Heritage monogram on brand
// burgundy; the maskable cut keeps the ring inside Android's 80% safe zone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "QR Starr",
    short_name: "QR Starr",
    start_url: "/",
    display: "browser",
    background_color: "#faf7f2",
    theme_color: "#faf7f2",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
