// Domain -> one of the eight schema categories. Runs only inside the extension: URLs are mapped here and never leave.
// Anything not recognised is dropped (not "Other"): unknown sites contribute nothing.
export const CATEGORIES = ["Sports", "Tech", "Food", "Travel", "Fashion", "Finance", "Games", "Health"] as const;
export type Category = (typeof CATEGORIES)[number];

const DOMAINS: Record<Category, string[]> = {
  Sports: ["espn.com", "cricbuzz.com", "espncricinfo.com", "nba.com", "fifa.com", "skysports.com", "decathlon.in", "strava.com", "olympics.com"],
  Tech: ["github.com", "stackoverflow.com", "amazon.in", "amazon.com", "flipkart.com", "apple.com", "theverge.com", "techcrunch.com", "gsmarena.com", "croma.com", "microsoft.com"],
  Food: ["swiggy.com", "zomato.com", "dominos.co.in", "starbucks.in", "allrecipes.com", "tasty.co", "blinkit.com", "zeptonow.com", "eatsure.com"],
  Travel: ["makemytrip.com", "booking.com", "airbnb.com", "irctc.co.in", "goibibo.com", "tripadvisor.com", "skyscanner.com", "uber.com", "olacabs.com", "expedia.com"],
  Fashion: ["myntra.com", "nykaa.com", "ajio.com", "zara.com", "hm.com", "tatacliq.com", "meesho.com", "vogue.com"],
  Finance: ["zerodha.com", "groww.in", "moneycontrol.com", "hdfcbank.com", "icicibank.com", "sbi.co.in", "paytm.com", "investopedia.com", "bloomberg.com", "policybazaar.com"],
  Games: ["steampowered.com", "store.steampowered.com", "twitch.tv", "epicgames.com", "playstation.com", "xbox.com", "roblox.com", "ign.com", "itch.io", "chess.com"],
  Health: ["practo.com", "1mg.com", "healthline.com", "webmd.com", "who.int", "cult.fit", "nhs.uk", "mayoclinic.org", "pharmeasy.in"],
};

const KEYWORDS: [RegExp, Category][] = [
  [/(cricket|football|soccer|sport|fitness|gym)/, "Sports"],
  [/(recipe|food|restaurant|kitchen|pizza|cafe|coffee)/, "Food"],
  [/(travel|hotel|flight|holiday|trip|tour)/, "Travel"],
  [/(fashion|apparel|shoes|jewel|beauty)/, "Fashion"],
  [/(bank|loan|insur|invest|stock|finance|mutualfund|crypto)/, "Finance"],
  [/(game|gaming|esports)/, "Games"],
  [/(health|clinic|pharma|doctor|medic|wellness)/, "Health"],
];

const BY_DOMAIN = new Map<string, Category>();
for (const c of CATEGORIES) for (const d of DOMAINS[c]) BY_DOMAIN.set(d, c);

/** Registrable-ish match: "www.m.swiggy.com" -> swiggy.com. Returns null for unknown or non-web URLs. */
export function categorize(url: string): Category | null {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    host = u.hostname.toLowerCase();
  } catch { return null; }
  const parts = host.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const hit = BY_DOMAIN.get(parts.slice(i).join("."));
    if (hit) return hit;
  }
  for (const [re, c] of KEYWORDS) if (re.test(host)) return c;
  return null;
}
