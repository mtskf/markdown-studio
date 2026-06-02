import React from "react";
import { Node, InputRule, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import katex from "katex";
import { useMathEditor } from "../hooks/useMathEditor";

function MathInlineView({
  node,
  updateAttributes,
  selected,
  editor,
  getPos,
}: any) {
  const { latex, setLatex, editing, inputRef, save, exit } =
    useMathEditor<HTMLInputElement>(
      node,
      updateAttributes,
      editor,
      getPos,
      selected,
    );

  if (editing) {
    return (
      <NodeViewWrapper as="span" className="math-inline-wrapper editing">
        <input
          ref={inputRef}
          className="math-inline-input"
          value={latex}
          onChange={(e) => setLatex(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            const input = e.currentTarget;
            const atStart =
              input.selectionStart === 0 && input.selectionEnd === 0;
            const atEnd =
              input.selectionStart === input.value.length &&
              input.selectionEnd === input.value.length;
            if (e.key === "Enter" || e.key === "Escape") {
              e.preventDefault();
              exit(true);
            } else if (
              (e.key === "ArrowLeft" && atStart) ||
              e.key === "ArrowUp"
            ) {
              e.preventDefault();
              exit(false);
            } else if (
              (e.key === "ArrowRight" && atEnd) ||
              e.key === "ArrowDown"
            ) {
              e.preventDefault();
              exit(true);
            }
          }}
          placeholder="E=mc^2"
          size={Math.max(latex.length + 2, 6)}
        />
      </NodeViewWrapper>
    );
  }

  let rendered: string;
  try {
    rendered = katex.renderToString(latex || "?", {
      throwOnError: false,
      displayMode: false,
    });
  } catch {
    rendered = `<span class="math-error">${latex}</span>`;
  }

  return (
    <NodeViewWrapper
      as="span"
      className={`math-inline-wrapper${selected ? " selected" : ""}`}
    >
      <span
        className="math-inline-rendered"
        onClick={() => setEditing(true)}
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
    </NodeViewWrapper>
  );
}

export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el: HTMLElement) =>
          el.getAttribute("data-latex") || el.textContent || "",
        renderHTML: (attrs: Record<string, any>) => ({
          "data-latex": attrs.latex,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="mathInline"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes({ "data-type": "mathInline" }, HTMLAttributes),
      node.attrs.latex,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathInlineView);
  },

  addInputRules() {
    // `$content$` → inline math node. Require non-space at both ends so that
    // currency phrasings like "$5 to $10" don't collapse into math, and use a
    // negative lookbehind on `$` so `$$x$$` block math isn't half-matched.
    return [
      new InputRule({
        find: /(?<!\$)\$([^\s$][^$\n]*?[^\s$]|[^\s$])\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1];
          if (!latex) return null;
          state.tr.replaceWith(
            range.from,
            range.to,
            this.type.create({ latex }),
          );
        },
      }),
    ];
  },
});
