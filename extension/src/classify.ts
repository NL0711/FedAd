// On-device topic guess for a page. It reads the title, the first headings, the menu links, the address words, the description and keywords
// and any structured data, scores them against the eight categories the shared model knows, and returns ONE label (or null when unsure).
// The text and the address are never stored or sent: only the label is kept, locally, as a training event.
//
// The eight categories are fixed because the model has one weight per category and the server shares that layout with every device.
// Adding a ninth means changing the model on the server for everyone, not just here.
export const WORDS: Record<string, string[]> = {
  Sports: ["sport", "cricket", "football", "soccer", "tennis", "basketball", "baseball", "hockey", "rugby", "golf", "olympic", "athlete", "athletics",
    "marathon", "fitness", "gym", "workout", "bodybuilding", "yoga", "league", "tournament", "championship", "fixture", "live score", "scores", "match",
    "premier league", "ipl", "nba", "nfl", "fifa", "uefa", "formula 1", "f1", "motogp", "wrestling", "boxing", "ufc", "badminton", "kabaddi", "cycling",
    "swimming", "transfer news", "sports news"],
  Tech: ["tech", "technology", "gadget", "smartphone", "mobile phone", "phone", "laptop", "software", "hardware", "android", "iphone", "ios", "programming",
    "developer", "coding", "startup", "artificial intelligence", "ai", "machine learning", "electronics", "processor", "chip", "headphones", "specs",
    "benchmark", "windows", "linux", "cloud computing", "cybersecurity", "robot", "drone", "gpu", "wearable", "smartwatch", "tablet", "5g", "semiconductor",
    "open source", "github", "chatgpt", "gadgets"],
  Food: ["recipe", "restaurant", "food", "dining", "cafe", "coffee", "tea", "cooking", "chef", "menu", "delivery", "kitchen", "pizza", "burger", "biryani",
    "bakery", "cuisine", "baking", "dessert", "vegan", "vegetarian", "breakfast", "lunch", "dinner", "snack", "grocery", "ingredients", "street food",
    "cocktail", "wine", "beer", "brewery", "meal", "foodie", "bbq", "grill", "noodles", "pasta", "salad", "curry", "sweets"],
  Travel: ["travel", "hotel", "flight", "holiday", "vacation", "tour", "resort", "booking", "trip", "itinerary", "airline", "destination", "beach", "visa",
    "hostel", "cruise", "sightseeing", "backpacking", "getaway", "tourism", "tourist", "airport", "passport", "road trip", "camping", "trek", "trekking",
    "homestay", "things to do", "train tickets", "car rental", "travel guide"],
  Fashion: ["fashion", "clothing", "clothes", "apparel", "shoes", "sneakers", "footwear", "dress", "style", "beauty", "makeup", "skincare", "jewellery",
    "jewelry", "handbag", "outfit", "denim", "saree", "kurta", "couture", "runway", "lingerie", "accessories", "cosmetics", "perfume", "fragrance",
    "haircare", "salon", "trends", "wardrobe", "boutique", "streetwear", "menswear", "womenswear"],
  Finance: ["finance", "financial", "bank", "banking", "loan", "credit card", "insurance", "invest", "investing", "investment", "mutual fund", "stock",
    "share market", "trading", "tax", "mortgage", "savings", "crypto", "bitcoin", "cryptocurrency", "sensex", "nifty", "forex", "economy", "budget",
    "retirement", "pension", "fintech", "broker", "ipo", "dividend", "bonds", "accounting", "payments", "upi", "personal finance", "credit score", "emi",
    "markets", "business news"],
  Games: ["game", "gaming", "esports", "playstation", "xbox", "nintendo", "steam", "console", "gamer", "minecraft", "fortnite", "valorant", "pc gaming",
    "walkthrough", "mods", "rpg", "fps", "mmorpg", "twitch", "indie games", "speedrun", "dota", "league of legends", "genshin", "gta", "roblox",
    "board game", "movie", "film", "series", "anime", "streaming", "netflix", "cinema", "box office", "ott", "trailer", "tv show"],
  Health: ["health", "medical", "doctor", "hospital", "wellness", "medicine", "pharmacy", "nutrition", "diet", "symptoms", "therapy", "mental health",
    "clinic", "vitamin", "sleep", "disease", "cancer", "diabetes", "covid", "vaccine", "surgery", "dental", "meditation", "mindfulness", "pregnancy",
    "weight loss", "healthcare", "patient", "cardiology", "ayurveda", "first aid", "blood pressure", "immunity"],
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RX: [string, RegExp[]][] = Object.entries(WORDS).map(([c, ws]) => [c, ws.map((w) => new RegExp(`(?<![a-z])${esc(w)}(?:s|es)?(?![a-z])`))]);

export interface Signals { strong: string; medium: string; weak: string }

/** Title, first heading, address words count 3; description, keywords, site name, structured data 2; sub-headings and menu links 1. */
export function scoreSignals(s: Signals): [string, number][] {
  const tiers: [string, number][] = [[s.strong.toLowerCase(), 3], [s.medium.toLowerCase(), 2], [s.weak.toLowerCase(), 1]];
  return RX.map(([cat, rxs]) => {
    let score = 0;
    for (const rx of rxs) for (const [text, w] of tiers) if (rx.test(text)) score += w;
    return [cat, score] as [string, number];
  }).sort((a, b) => b[1] - a[1]);
}

/** A label only when one category clearly leads. */
export function decide(scores: [string, number][]): string | null {
  const [best, second] = scores;
  return best[1] >= 4 && best[1] - second[1] >= 2 ? best[0] : null;
}

const meta = (name: string) =>
  document.querySelector<HTMLMetaElement>(`meta[name="${name}"], meta[property="${name}"]`)?.content ?? "";
const texts = (sel: string, n: number) => Array.from(document.querySelectorAll(sel)).slice(0, n).map((e) => e.textContent ?? "").join(" ");

export function pageSignals(): Signals {
  const path = decodeURIComponent(location.pathname).replace(/[\/_\-+.]/g, " ");
  const host = location.hostname.replace(/^www\./, "").replace(/[.\-]/g, " ");
  const ld = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 3).map((e) => e.textContent ?? "").join(" ").slice(0, 2000);
  return {
    strong: `${document.title} ${document.querySelector("h1")?.textContent ?? ""} ${host} ${path}`,
    medium: `${meta("description")} ${meta("keywords")} ${meta("og:site_name")} ${meta("og:type")} ${meta("og:title")} ${meta("article:section")} ${meta("article:tag")} ${ld}`,
    weak: `${texts("h2, h3", 15)} ${texts("header a, nav a", 30)}`,
  };
}

export const classifyPage = (): string | null => decide(scoreSignals(pageSignals()));

/** Topic of one link, from its own words (text, label, title, address words). Short text carries less, so the bar is lower than for a page. */
export function classifyLink(text: string, href: string): string | null {
  let path = "";
  try { const u = new URL(href, location.href); path = decodeURIComponent(u.pathname).replace(/[\/_\-+.]/g, " "); } catch { /* not a URL */ }
  const [best, second] = scoreSignals({ strong: `${text} ${path}`, medium: "", weak: "" });
  return best[1] >= 3 && best[1] > second[1] ? best[0] : null;
}
