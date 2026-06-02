import React from "react";
import { Node, mergeAttributes, nodePasteRule } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { CirclePlay } from "lucide-react";
import { useEmbedEditor } from "../hooks/useEmbedEditor";

// Matches bare YouTube URLs (watch, youtu.be short, shorts, embed forms).
// Used both to detect paste-as-URL and to validate inputs entered manually.
const YT_URL = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)[\w-]+|youtu\.be\/[\w-]+)(?:[?&#][^\s]*)?$/i;

export function isYouTubeUrl(url: string): boolean {
  return YT_URL.test(url.trim());
}

export function getYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0];
    if (/(^|\.)youtube\.com$/i.test(u.hostname)) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const m =
        u.pathname.match(/^\/embed\/([\w-]+)/) ||
        u.pathname.match(/^\/shorts\/([\w-]+)/);
      return m ? m[1] : null;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

function YouTubeEmbedView({
  node,
  updateAttributes,
  editor,
  getPos,
  deleteNode,
  selected,
}: any) {
  const { url, setUrl, editing, setEditing, inputRef, save, onKeyDown } =
    useEmbedEditor(node, updateAttributes, deleteNode, editor, getPos);

  const videoId = getYouTubeVideoId(url);

  if (editing) {
    return (
      <NodeViewWrapper className="embed-wrapper embed-editing">
        <div className="embed-edit-row">
          <CirclePlay size={16} className="embed-icon" />
          <input
            ref={inputRef}
            className="embed-url-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={save}
            onKeyDown={onKeyDown}
            placeholder="Paste YouTube URL (https://youtu.be/...)"
          />
        </div>
      </NodeViewWrapper>
    );
  }

  const wrapperClass = `embed-wrapper youtube-embed${selected ? " selected" : ""}`;

  if (!videoId) {
    return (
      <NodeViewWrapper className={wrapperClass}>
        <div className="embed-error" onClick={() => setEditing(true)}>
          Invalid YouTube URL — click to edit
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className={wrapperClass}>
      <a
        className="youtube-card"
        href={url}
        data-external="true"
        target="_blank"
        rel="noreferrer noopener"
      >
        <span className="youtube-thumb">
          <img
            src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
            alt=""
            loading="lazy"
          />
          <span className="youtube-play-overlay">
            <CirclePlay size={44} />
          </span>
        </span>
        <span className="youtube-card-text">
          <span className="youtube-card-title">YouTube video</span>
          <span className="youtube-card-subtitle">{url}</span>
        </span>
      </a>
    </NodeViewWrapper>
  );
}

export const YouTubeEmbed = Node.create({
  name: "youtubeEmbed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      url: {
        default: "",
        parseHTML: (el: HTMLElement) =>
          el.getAttribute("data-url") || el.textContent?.trim() || "",
        renderHTML: (attrs: Record<string, any>) => ({
          "data-url": attrs.url,
        }),
      },
    };
  },

  parseHTML() {
    // Higher priority than the default paragraph so the typed paragraph
    // doesn't swallow our embed when re-parsing the editor's HTML.
    return [{ tag: 'p[data-type="youtubeEmbed"]', priority: 1000 }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "p",
      mergeAttributes({ "data-type": "youtubeEmbed" }, HTMLAttributes),
      node.attrs.url,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(YouTubeEmbedView);
  },

  addPasteRules() {
    return [
      nodePasteRule({
        find: new RegExp(YT_URL.source, "gi"),
        type: this.type,
        getAttributes: (match) => ({ url: match[0] }),
      }),
    ];
  },
});
