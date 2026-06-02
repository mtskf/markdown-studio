import React from "react";
import { Node, mergeAttributes, nodePasteRule } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { Code, GitPullRequest, CircleDot, FileCode, Book } from "lucide-react";
import { useEmbedEditor } from "../hooks/useEmbedEditor";

// Matches github.com links to a specific repo / PR / issue / file. We avoid
// matching bare "github.com" or user profile URLs — those aren't useful as
// embed cards and are more likely accidental.
const GH_URL = /^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\/(?:pull|issues|blob|tree|commit)\/[^\s]+)?\/?$/i;

export function isGitHubUrl(url: string): boolean {
  return GH_URL.test(url.trim());
}

type ParsedGitHub =
  | { kind: "repo"; owner: string; repo: string }
  | { kind: "pr"; owner: string; repo: string; number: string }
  | { kind: "issue"; owner: string; repo: string; number: string }
  | { kind: "file"; owner: string; repo: string; ref: string; path: string }
  | { kind: "tree"; owner: string; repo: string; ref: string; path: string }
  | { kind: "commit"; owner: string; repo: string; sha: string }
  | null;

export function parseGitHubUrl(url: string): ParsedGitHub {
  try {
    const u = new URL(url.trim());
    if (u.hostname !== "github.com") return null;
    const parts = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (parts.length < 2) return null;
    const [owner, repo, kind, ...rest] = parts;
    if (!kind) return { kind: "repo", owner, repo };
    if (kind === "pull" && rest[0])
      return { kind: "pr", owner, repo, number: rest[0] };
    if (kind === "issues" && rest[0])
      return { kind: "issue", owner, repo, number: rest[0] };
    if (kind === "blob" && rest.length >= 2)
      return {
        kind: "file",
        owner,
        repo,
        ref: rest[0],
        path: rest.slice(1).join("/"),
      };
    if (kind === "tree" && rest.length >= 1)
      return {
        kind: "tree",
        owner,
        repo,
        ref: rest[0],
        path: rest.slice(1).join("/"),
      };
    if (kind === "commit" && rest[0])
      return { kind: "commit", owner, repo, sha: rest[0] };
    return { kind: "repo", owner, repo };
  } catch {
    return null;
  }
}

function cardDetails(info: ParsedGitHub): {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
} {
  const size = 18;
  switch (info?.kind) {
    case "pr":
      return {
        icon: <GitPullRequest size={size} />,
        title: `#${info.number}`,
        subtitle: `${info.owner}/${info.repo} · Pull request`,
      };
    case "issue":
      return {
        icon: <CircleDot size={size} />,
        title: `#${info.number}`,
        subtitle: `${info.owner}/${info.repo} · Issue`,
      };
    case "file":
      return {
        icon: <FileCode size={size} />,
        title: info.path,
        subtitle: `${info.owner}/${info.repo} @ ${info.ref}`,
      };
    case "tree":
      return {
        icon: <FileCode size={size} />,
        title: info.path || info.ref,
        subtitle: `${info.owner}/${info.repo} · Tree`,
      };
    case "commit":
      return {
        icon: <Code size={size} />,
        title: info.sha.slice(0, 7),
        subtitle: `${info.owner}/${info.repo} · Commit`,
      };
    case "repo":
      return {
        icon: <Book size={size} />,
        title: `${info.owner}/${info.repo}`,
        subtitle: "GitHub repository",
      };
    default:
      return {
        icon: <Code size={size} />,
        title: "GitHub",
        subtitle: "",
      };
  }
}

function GitHubEmbedView({
  node,
  updateAttributes,
  editor,
  getPos,
  deleteNode,
  selected,
}: any) {
  const { url, setUrl, editing, inputRef, save, onKeyDown } = useEmbedEditor(
    node,
    updateAttributes,
    deleteNode,
    editor,
    getPos,
  );

  if (editing) {
    return (
      <NodeViewWrapper className="embed-wrapper embed-editing">
        <div className="embed-edit-row">
          <Code size={16} className="embed-icon" />
          <input
            ref={inputRef}
            className="embed-url-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={save}
            onKeyDown={onKeyDown}
            placeholder="Paste GitHub URL (repo, PR, issue, file)"
          />
        </div>
      </NodeViewWrapper>
    );
  }

  const info = parseGitHubUrl(url);
  const { icon, title, subtitle } = cardDetails(info);

  return (
    <NodeViewWrapper
      className={`embed-wrapper github-embed${selected ? " selected" : ""}`}
    >
      <a
        className="github-card"
        href={url}
        data-external="true"
        target="_blank"
        rel="noreferrer noopener"
      >
        <span className="github-card-icon">{icon}</span>
        <span className="github-card-text">
          <span className="github-card-title">{title}</span>
          {subtitle && (
            <span className="github-card-subtitle">{subtitle}</span>
          )}
        </span>
      </a>
    </NodeViewWrapper>
  );
}

export const GitHubEmbed = Node.create({
  name: "githubEmbed",
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
    return [{ tag: 'p[data-type="githubEmbed"]', priority: 1000 }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "p",
      mergeAttributes({ "data-type": "githubEmbed" }, HTMLAttributes),
      node.attrs.url,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(GitHubEmbedView);
  },

  addPasteRules() {
    return [
      nodePasteRule({
        find: new RegExp(GH_URL.source, "gi"),
        type: this.type,
        getAttributes: (match) => ({ url: match[0] }),
      }),
    ];
  },
});
