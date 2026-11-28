/**
 * LOCAL DEV / REVIEW ONLY — mock partner locations for the "Where to find
 * QR STARR" map. Every row is is_mock = true, every partner name starts with
 * "TEST ·" and every address says it is a test address, so nothing here can
 * be mistaken for a real shop. The public page shows these rows only while
 * the server runs with PARTNER_MAP_MOCKS=1 on a non-hosted machine
 * (lib/partner-locations/flag.ts); hosted deployments refuse that flag.
 *
 *   npm run dev:seed-partner-locations            # insert / refresh
 *   npm run dev:seed-partner-locations -- --remove
 *
 * Refuses to run unless MIGRATIONS_DATABASE_URL points at a loopback host.
 * Coordinates are neighbourhood centres, not businesses.
 */
import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { isLoopbackHost } from "../src/lib/env-guards";

const PARTNERS = [
  { slug: "test-map-rose-atelier", name: "TEST · Rose Atelier" },
  { slug: "test-map-paper-gifts", name: "TEST · Paper & Gifts" },
  { slug: "test-map-sweet-corner", name: "TEST · Sweet Corner" },
] as const;

type Mock = {
  partner: (typeof PARTNERS)[number]["slug"];
  branch: string | null;
  category: string;
  addressKa: string;
  addressEn: string;
  cityKa: string;
  cityEn: string;
  districtKa: string | null;
  districtEn: string | null;
  lat: number;
  lng: number;
  phone: string | null;
  hoursKa: string | null;
  hoursEn: string | null;
  stocks: boolean;
};

const T = "სატესტო მისამართი";
const TE = "test address";
const MOCKS: Mock[] = [
  { partner: "test-map-rose-atelier", branch: "Vake", category: "FLOWERS", addressKa: `ჭავჭავაძის გამზირი — ${T}`, addressEn: `Chavchavadze Ave — ${TE}`, cityKa: "თბილისი", cityEn: "Tbilisi", districtKa: "ვაკე", districtEn: "Vake", lat: 41.7096, lng: 44.7631, phone: "+995 555 00 00 01", hoursKa: "ყოველდღე 10:00–21:00", hoursEn: "Daily 10:00–21:00", stocks: true },
  { partner: "test-map-rose-atelier", branch: "Old Tbilisi", category: "FLOWERS", addressKa: `ლესელიძის ქუჩა — ${T}`, addressEn: `Leselidze St — ${TE}`, cityKa: "თბილისი", cityEn: "Tbilisi", districtKa: "ძველი თბილისი", districtEn: "Old Tbilisi", lat: 41.6914, lng: 44.8068, phone: null, hoursKa: "ორშ–შაბ 11:00–20:00", hoursEn: "Mon–Sat 11:00–20:00", stocks: true },
  { partner: "test-map-rose-atelier", branch: "Batumi", category: "FLOWERS", addressKa: `ბულვარი — ${T}`, addressEn: `Boulevard — ${TE}`, cityKa: "ბათუმი", cityEn: "Batumi", districtKa: null, districtEn: null, lat: 41.6511, lng: 41.6363, phone: null, hoursKa: null, hoursEn: null, stocks: false },
  { partner: "test-map-paper-gifts", branch: null, category: "GIFTS", addressKa: `პეკინის გამზირი — ${T}`, addressEn: `Pekini Ave — ${TE}`, cityKa: "თბილისი", cityEn: "Tbilisi", districtKa: "საბურთალო", districtEn: "Saburtalo", lat: 41.7262, lng: 44.766, phone: "+995 555 00 00 02", hoursKa: "ყოველდღე 10:00–22:00", hoursEn: "Daily 10:00–22:00", stocks: true },
  { partner: "test-map-paper-gifts", branch: "Vera", category: "BOOKS", addressKa: `ზანდუკელის ქუჩა — ${T}`, addressEn: `Zandukeli St — ${TE}`, cityKa: "თბილისი", cityEn: "Tbilisi", districtKa: "ვერა", districtEn: "Vera", lat: 41.7065, lng: 44.7843, phone: null, hoursKa: null, hoursEn: null, stocks: true },
  { partner: "test-map-sweet-corner", branch: "Kutaisi", category: "CONFECTIONERY", addressKa: `რუსთაველის გამზირი — ${T}`, addressEn: `Rustaveli Ave — ${TE}`, cityKa: "ქუთაისი", cityEn: "Kutaisi", districtKa: null, districtEn: null, lat: 42.2707, lng: 42.705, phone: null, hoursKa: "ყოველდღე 09:00–20:00", hoursEn: "Daily 09:00–20:00", stocks: true },
  { partner: "test-map-sweet-corner", branch: "Didube", category: "CAFE", addressKa: `წერეთლის გამზირი — ${T}`, addressEn: `Tsereteli Ave — ${TE}`, cityKa: "თბილისი", cityEn: "Tbilisi", districtKa: "დიდუბე", districtEn: "Didube", lat: 41.7363, lng: 44.779, phone: null, hoursKa: null, hoursEn: null, stocks: true },
];

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing: NODE_ENV=production");
  const url = process.env.MIGRATIONS_DATABASE_URL;
  if (!url) throw new Error("MIGRATIONS_DATABASE_URL is required");
  if (!isLoopbackHost(new URL(url).hostname)) throw new Error("Refusing: mock locations are only for a local database");
  const remove = process.argv.includes("--remove");
  const sql = postgres(url, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      const slugs = PARTNERS.map((p) => p.slug);
      await tx`delete from partner_locations where is_mock or partner_id in (select id from partners where slug in ${tx(slugs)})`;
      await tx`delete from qr_codes where partner_id in (select id from partners where slug in ${tx(slugs)})`;
      await tx`delete from qr_batches where partner_id in (select id from partners where slug in ${tx(slugs)})`;
      await tx`delete from partners where slug in ${tx(slugs)}`;
      if (remove) return;

      const ids = new Map<string, string>();
      for (const p of PARTNERS) {
        const [row] = await tx`insert into partners (slug, name, status) values (${p.slug}, ${p.name}, 'ACTIVE') returning id`;
        ids.set(p.slug, row!.id as string);
      }
      // Real inventory for one partner, so "Cards in stock" is derived exactly as in production:
      // Rose Atelier holds 3 distributed, unsold cards; the others hold none.
      const rose = ids.get("test-map-rose-atelier")!;
      const [batch] = await tx`insert into qr_batches (partner_id, label, quantity) values (${rose}, 'TEST map fixtures', 3) returning id`;
      for (let i = 0; i < 3; i++) {
        const token = `TESTMAP${randomBytes(9).toString("hex").toUpperCase()}`.slice(0, 24);
        await tx`insert into qr_codes (public_token, batch_id, partner_id, status, distribution_status, distributed_at)
                 values (${token}, ${batch!.id}, ${rose}, 'AVAILABLE', 'DISTRIBUTED', now())`;
      }
      for (const m of MOCKS) {
        await tx`insert into partner_locations
          (partner_id, branch_name, category, address_ka, address_en, city_ka, city_en, district_ka, district_en,
           latitude, longitude, phone, hours_ka, hours_en, stocks_cards, is_public, is_mock, coordinates_verified_at)
          values (${ids.get(m.partner)!}, ${m.branch}, ${m.category}, ${m.addressKa}, ${m.addressEn}, ${m.cityKa}, ${m.cityEn},
                  ${m.districtKa}, ${m.districtEn}, ${m.lat}, ${m.lng}, ${m.phone}, ${m.hoursKa}, ${m.hoursEn}, ${m.stocks},
                  true, true, now())`;
      }
    });
    console.log(remove ? "Mock partner locations removed." : `Seeded ${MOCKS.length} mock locations for ${PARTNERS.length} TEST partners (is_mock = true).`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
