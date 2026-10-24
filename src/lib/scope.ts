/**
 * What FRIDAY hunts. SJSU-only: discovery reads only the SJSU on-campus sources, every job search is limited to on-campus
 * jobs, and the off-campus pages (Discover, Internships, Companies, Hunt) are hidden and redirect to SJSU Jobs.
 *
 * The off-campus sources, data and code are kept, not deleted: set this to false to bring them back.
 */
export const SJSU_ONLY = true;

/** Pages that only make sense with off-campus sources. */
export const OFF_CAMPUS_PAGES = ["/discover", "/internships", "/companies", "/hunt"];
