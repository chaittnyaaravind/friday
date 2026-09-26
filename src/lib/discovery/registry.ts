/**
 * Company registry. Every discoverable feed below was verified live (2026-09-23).
 * `watch` companies have no public feed FRIDAY may read — they appear in Companies
 * and watchlists with their official careers page, and users can import a specific
 * listing by URL. New companies are added here or discovered via imports.
 */
import type { SourceKind } from "./sources";

export type RegistryCompany = {
  slug: string;
  name: string;
  domain: string;
  hqCity: string;
  industry: string;
  careersUrl: string;
  ats: SourceKind | "watch";
  config?: Record<string, string>;
  isSjsu?: boolean;
};

const gh = (slug: string, name: string, token: string, domain: string, hqCity: string, industry: string): RegistryCompany => ({
  slug, name, domain, hqCity, industry, ats: "greenhouse", config: { token }, careersUrl: `https://boards.greenhouse.io/${token}`,
});
const lv = (slug: string, name: string, token: string, domain: string, hqCity: string, industry: string): RegistryCompany => ({
  slug, name, domain, hqCity, industry, ats: "lever", config: { token }, careersUrl: `https://jobs.lever.co/${token}`,
});
const ab = (slug: string, name: string, token: string, domain: string, hqCity: string, industry: string): RegistryCompany => ({
  slug, name, domain, hqCity, industry, ats: "ashby", config: { token }, careersUrl: `https://jobs.ashbyhq.com/${token}`,
});
const wd = (slug: string, name: string, tenant: string, host: string, site: string, domain: string, hqCity: string, industry: string): RegistryCompany => ({
  slug, name, domain, hqCity, industry, ats: "workday", config: { tenant, host, site }, careersUrl: `https://${tenant}.${host}.myworkdayjobs.com/${site}`,
});
const sr = (slug: string, name: string, token: string, domain: string, hqCity: string, industry: string): RegistryCompany => ({
  slug, name, domain, hqCity, industry, ats: "smartrecruiters", config: { token }, careersUrl: `https://jobs.smartrecruiters.com/${token}`,
});
const watch = (slug: string, name: string, careersUrl: string, domain: string, hqCity: string, industry: string): RegistryCompany => ({
  slug, name, domain, hqCity, industry, ats: "watch", careersUrl,
});
const sjsu = (slug: string, name: string, url: string, department?: string): RegistryCompany => ({
  slug, name, domain: "sjsu.edu", hqCity: "San Jose", industry: "SJSU", ats: "sjsu_page", careersUrl: url,
  config: { url, ...(department ? { department } : {}) }, isSjsu: true,
});

export const REGISTRY: RegistryCompany[] = [
  // ── Workday: Silicon Valley anchors ──
  wd("nvidia", "NVIDIA", "nvidia", "wd5", "NVIDIAExternalCareerSite", "nvidia.com", "Santa Clara", "Semiconductors & AI"),
  wd("adobe", "Adobe", "adobe", "wd5", "external_experienced", "adobe.com", "San Jose", "Software"),
  wd("cisco", "Cisco", "cisco", "wd5", "Cisco_Careers", "cisco.com", "San Jose", "Networking"),
  wd("intel", "Intel", "intel", "wd1", "External", "intel.com", "Santa Clara", "Semiconductors"),
  wd("salesforce", "Salesforce", "salesforce", "wd12", "External_Career_Site", "salesforce.com", "San Francisco", "Software"),
  wd("paypal", "PayPal", "paypal", "wd1", "jobs", "paypal.com", "San Jose", "Fintech"),
  wd("applied-materials", "Applied Materials", "amat", "wd1", "External", "appliedmaterials.com", "Santa Clara", "Semiconductors"),
  wd("hp", "HP", "hp", "wd5", "ExternalCareerSite", "hp.com", "Palo Alto", "Hardware"),
  wd("cadence", "Cadence", "cadence", "wd1", "External_Careers", "cadence.com", "San Jose", "EDA"),
  wd("ebay", "eBay", "ebay", "wd5", "apply", "ebay.com", "San Jose", "E-commerce"),
  wd("workday", "Workday", "workday", "wd5", "Workday", "workday.com", "Pleasanton", "Software"),
  wd("zoom", "Zoom", "zoom", "wd5", "Zoom", "zoom.com", "San Jose", "Software"),
  wd("kla", "KLA", "kla", "wd1", "Search", "kla.com", "Milpitas", "Semiconductors"),
  wd("marvell", "Marvell", "marvell", "wd1", "MarvellCareers", "marvell.com", "Santa Clara", "Semiconductors"),
  wd("broadcom", "Broadcom", "broadcom", "wd1", "External_Career", "broadcom.com", "Palo Alto", "Semiconductors"),
  wd("micron", "Micron", "micron", "wd1", "External", "micron.com", "San Jose", "Semiconductors"),
  wd("samsung-semiconductor", "Samsung Semiconductor", "sec", "wd3", "Samsung_Careers", "semiconductor.samsung.com", "San Jose", "Semiconductors"),

  // ── SmartRecruiters ──
  sr("servicenow", "ServiceNow", "ServiceNow", "servicenow.com", "Santa Clara", "Software"),
  sr("western-digital", "Western Digital", "WesternDigital", "westerndigital.com", "San Jose", "Storage"),

  // ── Greenhouse ──
  gh("databricks", "Databricks", "databricks", "databricks.com", "San Francisco", "Data & AI"),
  gh("stripe", "Stripe", "stripe", "stripe.com", "South San Francisco", "Fintech"),
  gh("figma", "Figma", "figma", "figma.com", "San Francisco", "Software"),
  gh("airbnb", "Airbnb", "airbnb", "airbnb.com", "San Francisco", "Consumer"),
  gh("roblox", "Roblox", "roblox", "roblox.com", "San Mateo", "Gaming"),
  gh("samsara", "Samsara", "samsara", "samsara.com", "San Francisco", "IoT"),
  gh("rubrik", "Rubrik", "rubrik", "rubrik.com", "Palo Alto", "Security"),
  gh("pure-storage", "Pure Storage", "purestorage", "purestorage.com", "Santa Clara", "Storage"),
  gh("zscaler", "Zscaler", "zscaler", "zscaler.com", "San Jose", "Security"),
  gh("cloudflare", "Cloudflare", "cloudflare", "cloudflare.com", "San Francisco", "Infrastructure"),
  gh("coinbase", "Coinbase", "coinbase", "coinbase.com", "Remote", "Fintech"),
  gh("robinhood", "Robinhood", "robinhood", "robinhood.com", "Menlo Park", "Fintech"),
  gh("anthropic", "Anthropic", "anthropic", "anthropic.com", "San Francisco", "AI"),
  gh("scale-ai", "Scale AI", "scaleai", "scale.com", "San Francisco", "AI"),
  gh("verkada", "Verkada", "verkada", "verkada.com", "San Mateo", "Security"),
  gh("dropbox", "Dropbox", "dropbox", "dropbox.com", "San Francisco", "Software"),
  gh("lyft", "Lyft", "lyft", "lyft.com", "San Francisco", "Mobility"),
  gh("reddit", "Reddit", "reddit", "reddit.com", "San Francisco", "Consumer"),
  gh("affirm", "Affirm", "affirm", "affirm.com", "San Francisco", "Fintech"),
  gh("doordash", "DoorDash", "doordashusa", "doordash.com", "San Francisco", "Consumer"),
  gh("instacart", "Instacart", "instacart", "instacart.com", "San Francisco", "Consumer"),
  gh("nuro", "Nuro", "nuro", "nuro.ai", "Mountain View", "Autonomy"),
  gh("waymo", "Waymo", "waymo", "waymo.com", "Mountain View", "Autonomy"),
  gh("sofi", "SoFi", "sofi", "sofi.com", "San Francisco", "Fintech"),
  gh("pinterest", "Pinterest", "pinterest", "pinterest.com", "San Francisco", "Consumer"),
  gh("glean", "Glean", "gleanwork", "glean.com", "Palo Alto", "AI"),
  gh("asana", "Asana", "asana", "asana.com", "San Francisco", "Software"),
  gh("brex", "Brex", "brex", "brex.com", "San Francisco", "Fintech"),
  gh("chime", "Chime", "chime", "chime.com", "San Francisco", "Fintech"),
  gh("discord", "Discord", "discord", "discord.com", "San Francisco", "Consumer"),
  gh("gusto", "Gusto", "gusto", "gusto.com", "San Francisco", "Software"),
  gh("twitch", "Twitch", "twitch", "twitch.tv", "San Francisco", "Consumer"),

  // ── Lever ──
  lv("palantir", "Palantir", "palantir", "palantir.com", "Palo Alto", "Software"),
  lv("zoox", "Zoox", "zoox", "zoox.com", "Foster City", "Autonomy"),
  lv("aeva", "Aeva", "aeva", "aeva.com", "Mountain View", "Autonomy"),
  lv("wealthfront", "Wealthfront", "wealthfront", "wealthfront.com", "Palo Alto", "Fintech"),

  // ── Ashby ──
  ab("openai", "OpenAI", "openai", "openai.com", "San Francisco", "AI"),
  ab("ramp", "Ramp", "ramp", "ramp.com", "New York", "Fintech"),
  ab("notion", "Notion", "notion", "notion.so", "San Francisco", "Software"),
  ab("perplexity", "Perplexity", "perplexity", "perplexity.ai", "San Francisco", "AI"),
  ab("harvey", "Harvey", "harvey", "harvey.ai", "San Francisco", "AI"),
  ab("replit", "Replit", "replit", "replit.com", "Foster City", "Developer Tools"),
  ab("cursor", "Cursor", "cursor", "cursor.com", "San Francisco", "Developer Tools"),
  ab("linear", "Linear", "linear", "linear.app", "San Francisco", "Developer Tools"),
  ab("supabase", "Supabase", "supabase", "supabase.com", "Remote", "Developer Tools"),
  ab("deepgram", "Deepgram", "deepgram", "deepgram.com", "San Francisco", "AI"),

  // ── Watch-only (no public feed FRIDAY may read) ──
  watch("apple", "Apple", "https://jobs.apple.com/en-us/search?team=internships-STDNT-INTRN", "apple.com", "Cupertino", "Hardware & Software"),
  watch("google", "Google", "https://www.google.com/about/careers/applications/jobs/results?target_level=INTERN_AND_APPRENTICE", "google.com", "Mountain View", "Software"),
  watch("meta", "Meta", "https://www.metacareers.com/jobs?roles[0]=Internship", "meta.com", "Menlo Park", "Software"),
  watch("microsoft", "Microsoft", "https://jobs.careers.microsoft.com/global/en/search?et=Internship", "microsoft.com", "Mountain View", "Software"),
  watch("amazon", "Amazon", "https://www.amazon.jobs/en/search?base_query=intern&loc_query=San+Jose%2C+CA", "amazon.com", "Sunnyvale", "E-commerce & Cloud"),
  watch("tesla", "Tesla", "https://www.tesla.com/careers/search/?type=3&site=US", "tesla.com", "Palo Alto", "Automotive & Energy"),
  watch("uber", "Uber", "https://www.uber.com/us/en/careers/list/?query=intern", "uber.com", "San Francisco", "Mobility"),
  watch("amd", "AMD", "https://careers.amd.com/careers-home/jobs?keywords=intern", "amd.com", "Santa Clara", "Semiconductors"),
  watch("qualcomm", "Qualcomm", "https://careers.qualcomm.com/careers?query=intern", "qualcomm.com", "Santa Clara", "Semiconductors"),
  watch("intuit", "Intuit", "https://jobs.intuit.com/category/college-jobs/27595/", "intuit.com", "Mountain View", "Fintech"),
  watch("synopsys", "Synopsys", "https://careers.synopsys.com/category/university-jobs/44408/", "synopsys.com", "Sunnyvale", "EDA"),
  watch("linkedin", "LinkedIn", "https://www.linkedin.com/company/linkedin/jobs/", "linkedin.com", "Sunnyvale", "Software"),
  watch("netflix", "Netflix", "https://explore.jobs.netflix.net/careers?query=intern", "netflix.com", "Los Gatos", "Entertainment"),
  watch("lam-research", "Lam Research", "https://careers.lamresearch.com/search/?q=intern", "lamresearch.com", "Fremont", "Semiconductors"),
  watch("palo-alto-networks", "Palo Alto Networks", "https://jobs.paloaltonetworks.com/en/students-and-new-grads", "paloaltonetworks.com", "Santa Clara", "Security"),
  watch("juniper", "Juniper Networks", "https://careers.juniper.net/", "juniper.net", "Sunnyvale", "Networking"),
  watch("fortinet", "Fortinet", "https://edel.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2001", "fortinet.com", "Sunnyvale", "Security"),
  watch("netapp", "NetApp", "https://careers.netapp.com/", "netapp.com", "San Jose", "Storage"),
  watch("intuitive-surgical", "Intuitive Surgical", "https://careers.intuitive.com/", "intuitive.com", "Sunnyvale", "Medical Devices"),

  // ── Added 2026-09-26 — each board verified live against its public API ──
  gh("astranis", "Astranis", "astranis", "astranis.com", "San Francisco", "Aerospace"),
  gh("datadog", "Datadog", "datadog", "datadoghq.com", "New York", "Cloud"),
  gh("flexport", "Flexport", "flexport", "flexport.com", "San Francisco", "Logistics"),
  gh("applovin", "AppLovin", "applovin", "applovin.com", "Palo Alto", "AdTech"),
  gh("duolingo", "Duolingo", "duolingo", "duolingo.com", "Pittsburgh", "EdTech"),
  gh("okta", "Okta", "okta", "okta.com", "San Francisco", "Security"),
  gh("toast", "Toast", "toast", "toasttab.com", "Boston", "Fintech"),
  gh("twilio", "Twilio", "twilio", "twilio.com", "San Francisco", "Communications"),
  gh("mongodb", "MongoDB", "mongodb", "mongodb.com", "New York", "Databases"),
  gh("elastic", "Elastic", "elastic", "elastic.co", "Mountain View", "Search"),
  gh("gitlab", "GitLab", "gitlab", "gitlab.com", "San Francisco", "DevOps"),
  gh("block", "Block", "block", "block.xyz", "San Francisco", "Fintech"),
  gh("attentive", "Attentive", "attentive", "attentive.com", "New York", "Marketing"),
  gh("amplitude", "Amplitude", "amplitude", "amplitude.com", "San Francisco", "Analytics"),
  gh("webflow", "Webflow", "webflow", "webflow.com", "San Francisco", "Software"),
  gh("airtable", "Airtable", "airtable", "airtable.com", "San Francisco", "Software"),
  gh("carta", "Carta", "carta", "carta.com", "San Francisco", "Fintech"),
  gh("fivetran", "Fivetran", "fivetran", "fivetran.com", "Oakland", "Data"),
  gh("cockroach-labs", "Cockroach Labs", "cockroachlabs", "cockroachlabs.com", "New York", "Databases"),
  gh("pagerduty", "PagerDuty", "pagerduty", "pagerduty.com", "San Francisco", "DevOps"),
  gh("mixpanel", "Mixpanel", "mixpanel", "mixpanel.com", "San Francisco", "Analytics"),
  gh("intercom", "Intercom", "intercom", "intercom.com", "San Francisco", "Software"),
  gh("faire", "Faire", "faire", "faire.com", "San Francisco", "Marketplace"),
  lv("spotify", "Spotify", "spotify", "spotify.com", "Stockholm", "Consumer"),
  lv("outreach", "Outreach", "outreach", "outreach.io", "Seattle", "Software"),
  lv("match-group", "Match Group", "matchgroup", "mtch.com", "Dallas", "Consumer"),
  lv("rover", "Rover", "rover", "rover.com", "Seattle", "Marketplace"),
  ab("sierra", "Sierra", "sierra", "sierra.ai", "San Francisco", "AI"),
  ab("cohere", "Cohere", "cohere", "cohere.com", "Toronto", "AI"),
  ab("mercor", "Mercor", "mercor", "mercor.com", "San Francisco", "AI"),
  ab("decagon", "Decagon", "decagon", "decagon.ai", "San Francisco", "AI"),
  ab("modal", "Modal", "modal", "modal.com", "New York", "Cloud"),
  ab("watershed", "Watershed", "watershed", "watershed.com", "San Francisco", "Climate"),
  ab("vanta", "Vanta", "vanta", "vanta.com", "San Francisco", "Security"),
  ab("runway", "Runway", "runway", "runwayml.com", "New York", "AI"),
  ab("elevenlabs", "ElevenLabs", "elevenlabs", "elevenlabs.io", "New York", "AI"),
  ab("posthog", "PostHog", "posthog", "posthog.com", "San Francisco", "Analytics"),
  ab("resend", "Resend", "resend", "resend.com", "San Francisco", "Developer tools"),

  // ── U.S. federal internships and Pathways roles via the official USAJOBS API (needs USAJOBS_API_KEY + USAJOBS_USER_AGENT) ──
  { slug: "usajobs", name: "U.S. Federal Government (USAJOBS)", domain: "usajobs.gov", hqCity: "Washington", industry: "Government", ats: "usajobs", careersUrl: "https://www.usajobs.gov", config: { keywords: "intern,student trainee,pathways", location: "San Jose, California", radius: "60" } },

  // ── SJSU official hiring pages (on-campus) ──
  sjsu("sjsu-associated-students", "SJSU Associated Students", "https://www.sjsu.edu/as/jobs/index.php", "Associated Students"),
  sjsu("sjsu-library", "SJSU King Library", "https://library.sjsu.edu/employment/employment-opportunities/", "King Library"),
  sjsu("sjsu-peer-connections", "SJSU Peer Connections", "https://peerconnections.sjsu.edu/programs/employment/index.html", "Peer Connections"),
  sjsu("sjsu-writing-center", "SJSU Writing Center", "https://www.sjsu.edu/writingcenter/jobs/index.php", "Writing Center"),
  sjsu("sjsu-student-union", "SJSU Student Union", "https://www.sjsu.edu/studentunion/get-involved/work-with-us/index.php", "Student Union"),
  sjsu("sjsu-research-foundation", "SJSU Research Foundation", "https://www.sjsu.edu/researchfoundation/employees/recruitment/index.php", "Research Foundation"),
  sjsu("sjsu-student-jobs", "SJSU Student Jobs", "https://www.sjsu.edu/careers/jobs/student-jobs.php", "SJSU"),
];

/** Links surfaced in the SJSU section even though they are not crawled. */
export const SJSU_LINKS = [
  { label: "SJSU Handshake", url: "https://sjsu.joinhandshake.com", note: "SJSU's primary job board — sign in with SJSUOne. Import any listing into FRIDAY by pasting its link." },
  { label: "Career Center: On-campus jobs & Work-Study", url: "https://careercenter.sjsu.edu/on-campus-jobs-federal-work-study/", note: "Official guide to on-campus employment and Federal Work-Study." },
  { label: "Financial Aid: Federal Work-Study", url: "https://www.sjsu.edu/faso/types-of-aid/work-study/index.php", note: "Check whether you have a Work-Study award." },
  { label: "Spartan Eats — Join our team", url: "https://dineoncampus.com/sjsu/join-our-team", note: "Dining jobs on campus." },
  { label: "ISSS: On-campus employment (F-1)", url: "https://www.sjsu.edu/isss/current-students/employment/campus.php", note: "Rules for international students working on campus." },
];
