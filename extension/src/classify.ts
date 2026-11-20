// On-device topic guess for a page on a site the user allowed. It reads only the title, the meta description and keywords, the
// first heading and the host name, scores them against the eight schema categories, and returns ONE category label (or null when
// unsure). The text and the address are never stored or sent; only the label is kept, locally, as a training event.
const WORDS: Record<string, string[]> = {
  Sports: ["sport", "cricket", "football", "soccer", "tennis", "fitness", "gym", "workout", "athlete", "nba", "fifa", "olympic", "running", "yoga", "league", "match score"],
  Tech: ["tech", "gadget", "smartphone", "laptop", "software", "android", "iphone", "programming", "developer", "ai ", "electronics", "processor", "headphones", "camera review", "app review"],
  Food: ["recipe", "restaurant", "food", "dining", "cafe", "coffee", "cooking", "chef", "menu", "delivery", "kitchen", "pizza", "biryani", "bakery", "cuisine"],
  Travel: ["travel", "hotel", "flight", "holiday", "vacation", "tour", "resort", "booking", "trip", "itinerary", "airline", "destination", "beach", "visa", "hostel"],
  Fashion: ["fashion", "clothing", "apparel", "shoes", "sneakers", "dress", "style", "beauty", "makeup", "skincare", "jewellery", "jewelry", "handbag", "outfit", "denim"],
  Finance: ["finance", "bank", "loan", "credit card", "insurance", "invest", "mutual fund", "stock", "trading", "tax", "mortgage", "savings", "crypto", "wallet", "sensex"],
  Games: ["game", "gaming", "esports", "playstation", "xbox", "steam", "console", "gamer", "minecraft", "fortnite", "streaming", "movie", "series", "anime", "trailer"],
  Health: ["health", "medical", "doctor", "hospital", "wellness", "medicine", "pharmacy", "nutrition", "diet", "symptom", "therapy", "mental health", "clinic", "vitamin", "sleep"],
};

const meta = (name: string) =>
  document.querySelector<HTMLMetaElement>(`meta[name="${name}"], meta[property="${name}"]`)?.content ?? "";

export function classifyPage(): string | null {
  const title = document.title.toLowerCase();
  const h1 = (document.querySelector("h1")?.textContent ?? "").toLowerCase();
  const strong = `${title} ${h1} ${location.hostname.replace(/[.\-]/g, " ").toLowerCase()}`;
  const weak = `${meta("description")} ${meta("keywords")} ${meta("og:site_name")} ${meta("og:type")}`.toLowerCase();
  const scores = Object.entries(WORDS).map(([cat, ws]) => {
    let s = 0;
    for (const w of ws) { if (strong.includes(w)) s += 2; if (weak.includes(w)) s += 1; }
    return [cat, s] as const;
  }).sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  return best[1] >= 3 && best[1] > second[1] ? best[0] : null;
}
