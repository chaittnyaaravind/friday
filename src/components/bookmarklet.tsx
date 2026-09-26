"use client";

import { Bookmark, Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { bookmarkletSource } from "@/lib/discovery/capture";
import { Button, Card } from "./ui";

/** Draggable "Send to FRIDAY" bookmarklet plus a copy fallback. It reads only the page you are viewing. */
export function BookmarkletCard() {
  const link = useRef<HTMLAnchorElement>(null);
  const [copied, setCopied] = useState(false);

  // React refuses `javascript:` URLs in JSX, so the address is set on the element directly.
  useEffect(() => {
    link.current?.setAttribute("href", bookmarkletSource(window.location.origin));
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(bookmarkletSource(window.location.origin));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard unavailable — dragging still works */
    }
  };

  return (
    <Card className="flex flex-col gap-5 p-6">
      <div className="flex flex-col gap-1.5">
        <span className="label">Bookmarklet</span>
        <h3 className="text-[22px]">Send any listing to FRIDAY</h3>
        <p className="max-w-[60ch] text-[13.5px] leading-relaxed text-muted">
          Works on Handshake, LinkedIn, Indeed and any company careers page. When you are looking at a job, click the bookmark: FRIDAY opens with the title, company, location and description filled in, and you confirm the import. It reads only the page you are already viewing, in your own browser. FRIDAY never signs in to those sites.
        </p>
      </div>
      <ol className="flex flex-col gap-3 text-[13.5px] leading-relaxed">
        <li className="flex flex-wrap items-center gap-3">
          <span className="num font-mono text-[12px] text-dim">1</span>
          <span>Drag this button onto your bookmarks bar</span>
          <a
            ref={link}
            draggable
            onClick={(e) => e.preventDefault()}
            className="inline-flex cursor-grab items-center gap-2 rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-white shadow-sm active:cursor-grabbing"
          >
            <Bookmark size={14} /> Send to FRIDAY
          </a>
          <Button type="button" size="sm" variant="secondary" onClick={copy}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy instead"}
          </Button>
        </li>
        <li className="flex gap-3"><span className="num font-mono text-[12px] text-dim">2</span><span>Open a job on Handshake, LinkedIn, Indeed or an employer site. Selecting the description text first gives the best result.</span></li>
        <li className="flex gap-3"><span className="num font-mono text-[12px] text-dim">3</span><span>Click <b>Send to FRIDAY</b>, check the details, and press Import. FRIDAY matches it to your profile and merges it with anything it already found.</span></li>
      </ol>
      <p className="text-[12px] text-dim">If your bookmarks bar is hidden, use Copy instead: create a new bookmark and paste the copied text as its address.</p>
    </Card>
  );
}
