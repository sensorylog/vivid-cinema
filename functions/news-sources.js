// Candidate registry for Vivid Cinema's curated newsroom.
// A feed stays disabled until its reuse/display terms and source quality have been reviewed.
// Do not turn a source on just because its RSS endpoint is reachable.
export const NEWS_SOURCES = [
  {
    id: "variety",
    publisher: "Variety",
    feedUrl: "https://variety.com/feed/",
    domain: "variety.com",
    category: "industry",
    region: "global",
    regionLabel: "Global",
    approvedForUse: false
  },
  {
    id: "deadline",
    publisher: "Deadline",
    feedUrl: "https://deadline.com/feed/",
    domain: "deadline.com",
    category: "industry",
    region: "global",
    regionLabel: "Global",
    approvedForUse: false
  },
  {
    id: "punch-entertainment",
    publisher: "PUNCH",
    feedUrl: "https://rss.punchng.com/v1/category/entertainment",
    domain: "punchng.com",
    category: "nollywood",
    region: "africa",
    regionLabel: "Nigeria / African cinema",
    approvedForUse: false
  },
  {
    id: "bellanaija",
    publisher: "BellaNaija",
    feedUrl: "https://www.bellanaija.com/feed/",
    domain: "bellanaija.com",
    category: "africa",
    region: "africa",
    regionLabel: "African entertainment",
    approvedForUse: false
  },
  {
    id: "pulse-ghana",
    publisher: "Pulse Ghana",
    feedUrl: null,
    sourceUrl: "https://www.pulse.com.gh/entertainment",
    domain: "pulse.com.gh",
    category: "ghana",
    region: "ghana",
    regionLabel: "Ghana",
    approvedForUse: false,
    note: "Use as a manual editorial candidate until an approved feed/API and display terms are verified. Do not scrape the page."
  }
];
