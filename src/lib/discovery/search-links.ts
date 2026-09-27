/**
 * "Search everywhere near me": ready-made links to each job site's OWN live search, pre-filled with the student's
 * query, location and radius. FRIDAY never fetches, scrapes or signs in to these sites — the student opens them in
 * their own browser, and can bring any listing back with the Send-to-FRIDAY bookmarklet.
 */
export type SearchLinkInput = {
  /** What to look for, e.g. "software engineer intern". Blank falls back to a sensible default. */
  query?: string;
  /** City to search around, e.g. "San Jose". */
  city: string;
  state?: string;
  radiusMiles: number;
  /** Narrow to internships where the site supports it. */
  internship?: boolean;
  /** Only postings from roughly the last day where the site supports it. */
  lastDay?: boolean;
};

export type SearchLink = { id: string; name: string; url: string; note: string };

const DEFAULT_QUERY = "software engineer intern";
const enc = encodeURIComponent;

export function searchLinks(i: SearchLinkInput): SearchLink[] {
  const q = i.query?.trim() || DEFAULT_QUERY;
  const state = i.state ?? "CA";
  const where = `${i.city}, ${state}`;
  const r = Math.max(5, Math.min(100, Math.round(i.radiusMiles)));

  return [
    {
      id: "linkedin",
      name: "LinkedIn",
      note: "Sign in on LinkedIn to see everything.",
      url: `https://www.linkedin.com/jobs/search/?keywords=${enc(q)}&location=${enc(where)}&distance=${r}${i.internship ? "&f_JT=I" : ""}${i.lastDay ? "&f_TPR=r86400" : ""}`,
    },
    {
      id: "handshake",
      name: "SJSU Handshake",
      note: "Opens SJSU's Handshake — sign in with your SJSU account.",
      url: `https://sjsu.joinhandshake.com/stu/postings?query=${enc(q)}`,
    },
    {
      id: "indeed",
      name: "Indeed",
      note: "",
      url: `https://www.indeed.com/jobs?q=${enc(q)}&l=${enc(where)}&radius=${r}${i.internship ? "&jt=internship" : ""}${i.lastDay ? "&fromage=1" : ""}`,
    },
    {
      id: "google",
      name: "Google Jobs",
      note: "Aggregates many sites.",
      url: `https://www.google.com/search?q=${enc(`${q} jobs near ${where}`)}&ibp=htl;jobs`,
    },
    {
      id: "glassdoor",
      name: "Glassdoor",
      note: "",
      url: `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${enc(q)}&locKeyword=${enc(where)}`,
    },
    {
      id: "wellfound",
      name: "Wellfound",
      note: "Startups.",
      url: `https://wellfound.com/jobs?q=${enc(q)}`,
    },
    {
      id: "sjsu",
      name: "SJSU Career Center",
      note: "Official SJSU career resources.",
      url: "https://www.sjsu.edu/careercenter/",
    },
  ];
}
