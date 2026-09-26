/**
 * One-click capture. A bookmarklet reads the job page the student is ALREADY looking at (in their own
 * browser, with their own session) and opens FRIDAY's /import page pre-filled. FRIDAY never signs in to
 * LinkedIn, Handshake or Indeed and never fetches those sites itself; the student confirms every import.
 */

export type CaptureSource = "handshake" | "linkedin" | "indeed" | "other";

export const CAPTURE_LIMITS = { url: 2000, title: 200, company: 120, location: 200, description: 6000 } as const;

/** Guess where a listing came from, from its address. */
export function sourceFromUrl(raw: string): CaptureSource {
  let host = "";
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (host === "joinhandshake.com" || host.endsWith(".joinhandshake.com")) return "handshake";
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return "linkedin";
  if (host === "indeed.com" || host.endsWith(".indeed.com")) return "indeed";
  return "other";
}

/** Clip a prefill value from the URL to what the import API accepts. */
export function clip(value: string | string[] | undefined, max: number): string {
  const v = Array.isArray(value) ? value[0] : value;
  return (v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * The bookmarklet, as one line of JavaScript for a `javascript:` URL. It prefers the page's structured
 * JobPosting data (JSON-LD), then falls back to the visible title/heading and whatever the student selected.
 * The address is kept short enough for any server to accept.
 */
export function bookmarkletSource(origin: string): string {
  const src = `(function(){
var O=${JSON.stringify(origin)},d=document,sp=function(s){return(s||"").replace(/\\s+/g," ").trim()};
var ld=null;
[].slice.call(d.querySelectorAll('script[type="application/ld+json"]')).some(function(s){try{var j=JSON.parse(s.textContent),a=Array.isArray(j)?j:(j["@graph"]||[j]);for(var i=0;i<a.length;i++){if(a[i]&&a[i]["@type"]==="JobPosting"){ld=a[i];return true}}}catch(e){}return false});
var txt=function(x){var e=d.createElement("div");e.innerHTML=x||"";return sp(e.textContent)};
var meta=function(n){var e=d.querySelector('meta[property="'+n+'"],meta[name="'+n+'"]');return e?e.content:""};
var h1=d.querySelector("h1");
var title=sp(ld&&ld.title)||sp(h1&&h1.textContent)||sp(meta("og:title"))||sp(d.title);
var org=ld&&ld.hiringOrganization,company=sp(org&&(org.name||org))||sp(meta("og:site_name"));
var jl=ld&&ld.jobLocation;jl=Array.isArray(jl)?jl[0]:jl;var ad=jl&&jl.address,place=sp(ad&&[ad.addressLocality,ad.addressRegion].filter(Boolean).join(", "));
var sel=sp(String(window.getSelection()));
var main=d.querySelector("main")||d.body;
var desc=sel||txt(ld&&ld.description)||sp(main.innerText);
var page=location.href.split("#")[0];
var q=function(dd){return O+"/import?url="+encodeURIComponent(page.slice(0,${CAPTURE_LIMITS.url}))+"&title="+encodeURIComponent(title.slice(0,${CAPTURE_LIMITS.title}))+"&company="+encodeURIComponent(company.slice(0,${CAPTURE_LIMITS.company}))+"&location="+encodeURIComponent(place.slice(0,${CAPTURE_LIMITS.location}))+"&description="+encodeURIComponent(dd)};
var n=Math.min(desc.length,${CAPTURE_LIMITS.description}),u=q(desc.slice(0,n));
while(u.length>7500&&n>200){n=Math.floor(n*0.8);u=q(desc.slice(0,n))}
window.open(u,"_blank","noopener");
})();`;
  return "javascript:" + src.replace(/\n/g, "");
}
