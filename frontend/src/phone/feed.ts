// Content of the demo feed: fictional "Sponsored (demo)" ads in the 8 schema categories, plus plain filler cards.
// Nothing is fetched from the network; the cards are text and CSS only.

export interface Ad {
  cat: string;
  brand: string;
  headline: string;
  body: string;
  cta: string;
}

export const CAT_COLOR: Record<string, string> = {
  Sports: "#0b6e4f", Tech: "#1d4ed8", Food: "#b45309", Travel: "#0e7490",
  Fashion: "#9d174d", Finance: "#334155", Games: "#6d28d9", Health: "#15803d",
};

const ADS: Ad[] = [
  { cat: "Sports", brand: "Stridefield", headline: "Run your first 10K in 8 weeks", body: "A beginner plan with a pace coach in your pocket.", cta: "Start the plan" },
  { cat: "Sports", brand: "Apex Cycles", headline: "City bikes, 20% lighter", body: "Carbon frames built for the morning commute.", cta: "See the range" },
  { cat: "Sports", brand: "Court Kings", headline: "Book a badminton court tonight", body: "Courts near you, 6 to 10 pm, no deposit.", cta: "Check slots" },
  { cat: "Tech", brand: "Pixelon", headline: "A phone that lasts two days", body: "Fast charging, clean software, five years of updates.", cta: "Compare models" },
  { cat: "Tech", brand: "Nimbus Cloud", headline: "Back up your photos for free", body: "15 GB, end-to-end encrypted, nothing to configure.", cta: "Get started" },
  { cat: "Tech", brand: "Keywave", headline: "The quiet mechanical keyboard", body: "Hot-swappable switches, 80 hours per charge.", cta: "View keyboards" },
  { cat: "Food", brand: "Masala Box", headline: "Dinner in 15 minutes", body: "Regional recipe kits delivered fresh, skip any week.", cta: "Pick your meals" },
  { cat: "Food", brand: "Brew Lane", headline: "Single-origin coffee, roasted this week", body: "Choose a grind, we ship on Monday.", cta: "Try a bag" },
  { cat: "Food", brand: "Leaf & Co", headline: "Salads that are not boring", body: "Twelve bowls, all under 500 calories.", cta: "See the menu" },
  { cat: "Travel", brand: "Wayfare", headline: "Weekend trains to the hills", body: "Compare fares and book a seat in two taps.", cta: "Find a trip" },
  { cat: "Travel", brand: "Stayly", headline: "Homestays with a view", body: "Verified hosts, free cancellation up to 48 hours.", cta: "Browse stays" },
  { cat: "Travel", brand: "Pack Light", headline: "One carry-on, ten days", body: "A travel checklist built from 2,000 trips.", cta: "Get the list" },
  { cat: "Fashion", brand: "Loom & Thread", headline: "Handloom shirts, made to measure", body: "Fit guaranteed or we remake it.", cta: "Design yours" },
  { cat: "Fashion", brand: "Sole Society", headline: "Sneakers you can wear to work", body: "Recycled soles, ten colours, free returns.", cta: "Shop sneakers" },
  { cat: "Fashion", brand: "Monsoon Co", headline: "Rain jackets that fold into a pocket", body: "Waterproof, 190 grams, three sizes.", cta: "See jackets" },
  { cat: "Finance", brand: "Coinwise", headline: "Save a little every day", body: "Round up your spends into a savings pot.", cta: "Open a pot" },
  { cat: "Finance", brand: "Clearly Insure", headline: "Health cover in 5 minutes", body: "No agents, plain terms, claims in the app.", cta: "Get a quote" },
  { cat: "Finance", brand: "Taxy", headline: "File your return before the deadline", body: "Guided steps, expert review included.", cta: "Start filing" },
  { cat: "Games", brand: "Quest Forge", headline: "A puzzle game with no timers", body: "400 hand-made levels, play offline.", cta: "Play free" },
  { cat: "Games", brand: "Tiny Kingdoms", headline: "Build a village in ten minutes a day", body: "Calm strategy for short breaks.", cta: "Download" },
  { cat: "Games", brand: "Pixel Arena", headline: "Weekend tournament, 5,000 prize", body: "Free to enter, brackets for all skill levels.", cta: "Join the bracket" },
  { cat: "Health", brand: "Calm Hour", headline: "Sleep better in two weeks", body: "A short evening routine, backed by sleep research.", cta: "Try 7 days free" },
  { cat: "Health", brand: "Fit Check", headline: "A 12-minute home workout", body: "No equipment, a new plan every Monday.", cta: "Start today" },
  { cat: "Health", brand: "Herbal Roots", headline: "Talk to a doctor tonight", body: "Video consults from 8 to 11 pm, from 199.", cta: "Book a consult" },
];

export const FILLER: { title: string; body: string }[] = [
  { title: "Did you know?", body: "Federated learning trains a model across many devices without gathering their raw data in one place." },
  { title: "Tip", body: "Scroll at your normal pace. This demo only learns from how you actually react to the ads." },
  { title: "Fact", body: "A clipped model update has a bounded size, which is what lets calibrated noise give a privacy guarantee." },
  { title: "Reminder", body: "Everything you tap stays on this phone. Only a noised model update can be sent, and only when you press Contribute." },
  { title: "Idea of the day", body: "Pick the ads you would genuinely click. Fake preferences make a fine demo, but real ones show the point." },
  { title: "Note", body: "These ads are fictional. Nothing here loads from the internet and no advertiser exists." },
  { title: "Why noise?", body: "Noise hides any one person's contribution inside the crowd; more people means a clearer overall picture." },
  { title: "Did you know?", body: "Click-through rate is the share of ad views that end in a tap. Typical display ads see well under 5 percent." },
];

export function randomAd(rnd: () => number): Ad {
  return ADS[Math.floor(rnd() * ADS.length)];
}

export function randomFiller(rnd: () => number) {
  return FILLER[Math.floor(rnd() * FILLER.length)];
}

// One block of the feed. "top" is a large hero card, "middle" a normal card, "bottom" a compact card.
export const BLOCK: ("ad:top" | "ad:middle" | "ad:bottom" | "filler")[] = [
  "ad:top", "filler", "ad:middle", "filler", "ad:middle", "filler", "ad:middle", "ad:bottom",
];
