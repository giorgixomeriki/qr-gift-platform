import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { listPublicPartnerLocations } from "@/lib/partner-locations/public";
import { getLanding } from "../copy";
import { LocationsExplorer } from "./explorer";
import type { LocationsLabels } from "./labels";
import "./locations.css";

/**
 * "Where to find QR STARR" on the home page. Server-rendered from the only
 * public read path (app_public_partner_locations: public + verified +
 * ACTIVE partner + not a test fixture). With no such location the section is
 * not rendered at all — the page never shows an empty or invented map.
 */
export async function PartnerLocations() {
  const { text, raw, ctx } = await getLanding();
  const locations = await listPublicPartnerLocations(ctx.locale);
  if (locations.length === 0) return null;
  const labels = raw<LocationsLabels>("locations");
  return (
    <section className="hm-section hm-locations" id="where-to-find" aria-labelledby="hm-locations-title" data-testid="home-locations">
      <div className="hm-wrap">
        <header className="hm-head" data-reveal>
          <p className="hm-kicker">{text("locations.eyebrow")}</p>
          <h2 id="hm-locations-title" className="hm-title">
            {text("locations.title")}
          </h2>
          <p className="hm-lead">{text("locations.lead")}</p>
        </header>
        <LocationsExplorer locations={locations} labels={labels} locale={ctx.locale} />
        <p className="hm-loc__partner">
          {text("locations.partnerPrompt")}{" "}
          <Link href="/contact" className="hm-link">
            {text("locations.partnerLink")}
            <ArrowRight size={16} aria-hidden />
          </Link>
        </p>
      </div>
    </section>
  );
}
