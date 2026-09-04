import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

export interface ExtractedArticle {
  title: string | null;
  byline: string | null;
  html: string;
  text: string;
  markdown: string;
}

/** Pulls the main article out of a page, discarding nav/ads/chrome. */
export function extractReadable(html: string, url: string): ExtractedArticle | null {
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  if (!article || !article.content) return null;
  return {
    title: article.title ?? null,
    byline: article.byline ?? null,
    html: article.content,
    text: article.textContent?.trim() ?? "",
    markdown: turndown.turndown(article.content),
  };
}

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html);
}

export function htmlToText(html: string): string {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  doc.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
  return (doc.body?.textContent ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
