import React from "react";
import { Heading } from "@tiptap/extension-heading";
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  NodeViewContent,
  type Editor,
} from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { ChevronDown, ChevronRight } from "lucide-react";
import { vscodeApi } from "../vscode-api";

interface HeadingFoldState {
  folded: Set<number>;
  decorations: DecorationSet;
  positionToIndex: Map<number, number>;
}

interface HeadingFoldMeta {
  folded: Set<number>;
}

export const HEADING_FOLD_KEY = new PluginKey<HeadingFoldState>("headingFold");

/**
 * Walk the top level of the document and produce:
 *   - the position → heading-index map (NodeViews use this to know their index)
 *   - the DecorationSet that hides every node falling under a folded heading
 *
 * "Folded" hides every sibling block between a folded heading and the next
 * same-or-higher-level heading (Notion / outline style). Headings nested
 * inside a folded range are themselves hidden but their fold flag is
 * preserved — unfolding the outer heading restores the inner state.
 */
function computeFoldState(doc: PMNode, folded: Set<number>): HeadingFoldState {
  const positionToIndex = new Map<number, number>();
  const decos: Decoration[] = [];
  // Stack of currently active outer folds (heading levels whose content range
  // we are still inside). Only the top of the stack matters when deciding
  // whether the next heading closes a fold.
  const foldStack: { level: number }[] = [];
  let headingIdx = -1;

  doc.forEach((node, offset) => {
    let hidden = foldStack.length > 0;
    if (node.type.name === "heading") {
      headingIdx++;
      positionToIndex.set(offset, headingIdx);
      const level = node.attrs.level as number;
      // A same-or-higher-level heading closes outer folds.
      while (
        foldStack.length > 0 &&
        level <= foldStack[foldStack.length - 1].level
      ) {
        foldStack.pop();
      }
      // Recompute hidden after closing: this heading itself is hidden only
      // if there's still an outer fold open above it.
      hidden = foldStack.length > 0;
      // Open a new fold only when the heading itself is visible — otherwise
      // its toggle isn't clickable and the fold flag waits silently until
      // the outer heading is unfolded.
      if (folded.has(headingIdx) && !hidden) {
        foldStack.push({ level });
      }
    }
    if (hidden) {
      decos.push(
        Decoration.node(offset, offset + node.nodeSize, {
          style: "display: none",
          "data-fold-hidden": "true",
        }),
      );
    }
  });

  return {
    folded,
    decorations: DecorationSet.create(doc, decos),
    positionToIndex,
  };
}

function createHeadingFoldPlugin(): Plugin {
  return new Plugin<HeadingFoldState>({
    key: HEADING_FOLD_KEY,
    state: {
      init(_, state) {
        return computeFoldState(state.doc, new Set());
      },
      apply(tr, prev, _oldState, newState) {
        const meta = tr.getMeta(HEADING_FOLD_KEY) as
          | HeadingFoldMeta
          | undefined;
        const nextFolded = meta?.folded ?? prev.folded;
        if (!tr.docChanged && nextFolded === prev.folded) return prev;
        return computeFoldState(newState.doc, nextFolded);
      },
    },
    props: {
      decorations(state) {
        return (
          HEADING_FOLD_KEY.getState(state)?.decorations ?? DecorationSet.empty
        );
      },
    },
  });
}

/**
 * Restore a persisted fold set without echoing it back to the host. Called
 * from useEditorState after the initial markdown is loaded into the editor.
 */
export function setInitialHeadingFolds(editor: Editor, folds: number[]): void {
  const tr = editor.state.tr;
  tr.setMeta(HEADING_FOLD_KEY, {
    folded: new Set(folds),
  } satisfies HeadingFoldMeta);
  editor.view.dispatch(tr);
}

function HeadingView({ node, getPos, editor }: any) {
  // Tiptap's ReactNodeViewRenderer.update() short-circuits when node and
  // decorations are reference-equal. Fold toggles dispatch a meta-only
  // transaction (docChanged=false, no node-level decoration on the heading
  // itself), so without this subscription the chevron + .is-folded class
  // stay stale until the next doc-changing edit. Re-read plugin state on
  // every fold meta transaction.
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    const handler = ({ transaction }: { transaction: { getMeta: (k: any) => unknown } }) => {
      if (transaction.getMeta(HEADING_FOLD_KEY) !== undefined) force();
    };
    editor.on("transaction", handler);
    return () => {
      editor.off("transaction", handler);
    };
  }, [editor]);

  const level: number = node.attrs.level ?? 1;
  const pluginState = HEADING_FOLD_KEY.getState(editor.state);
  const pos = typeof getPos === "function" ? getPos() : null;
  const index =
    typeof pos === "number"
      ? (pluginState?.positionToIndex.get(pos) ?? -1)
      : -1;
  const isFolded = index >= 0 && pluginState?.folded.has(index) === true;

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (index < 0) return;
    const current =
      HEADING_FOLD_KEY.getState(editor.state)?.folded ?? new Set<number>();
    const next = new Set(current);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    const tr = editor.state.tr;
    tr.setMeta(HEADING_FOLD_KEY, { folded: next } satisfies HeadingFoldMeta);
    editor.view.dispatch(tr);
    vscodeApi.postMessage({
      type: "saveHeadingFolds",
      folds: Array.from(next).sort((a, b) => a - b),
    });
  };

  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  const ariaLabel = isFolded ? "Unfold heading" : "Fold heading";

  return (
    <NodeViewWrapper
      as={Tag}
      className={`heading-with-toggle${isFolded ? " is-folded" : ""}`}
    >
      <button
        type="button"
        contentEditable={false}
        className="heading-fold-toggle"
        onMouseDown={toggle}
        aria-label={ariaLabel}
        title={ariaLabel}
        tabIndex={-1}
      >
        {isFolded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
      </button>
      <NodeViewContent as={"span" as "div"} />
    </NodeViewWrapper>
  );
}

export const HeadingFold = Heading.extend({
  addNodeView() {
    return ReactNodeViewRenderer(HeadingView);
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), createHeadingFoldPlugin()];
  },
});
