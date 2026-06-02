import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";

interface MathNode {
  attrs: { latex: string; [key: string]: any };
  nodeSize: number;
}

interface UseMathEditorReturn<
  T extends HTMLInputElement | HTMLTextAreaElement,
> {
  latex: string;
  setLatex: (value: string) => void;
  editing: boolean;
  setEditing: (value: boolean) => void;
  inputRef: RefObject<T>;
  save: () => void;
  exit: (after: boolean) => void;
}

// Shared NodeView logic for KaTeX math atoms (inline + block).
// Owns the editing-mode state, focus management, NodeSelection-driven
// entry into edit mode, and save/exit semantics that re-place the caret
// in the outer editor after dismissal. Each NodeView keeps its own
// keyboard handler because textarea (multi-line, first/last-line nav)
// and input (single-line, Enter to exit) need different rules.
export function useMathEditor<
  T extends HTMLInputElement | HTMLTextAreaElement,
>(
  node: MathNode,
  updateAttributes: (attrs: Record<string, any>) => void,
  editor: Editor | undefined,
  getPos: (() => number) | undefined,
  selected: boolean,
): UseMathEditorReturn<T> {
  const [editing, setEditing] = useState(!node.attrs.latex);
  const [latex, setLatex] = useState<string>(node.attrs.latex);
  const inputRef = useRef<T>(null);

  // Enter editing mode only when this node is the *exact* NodeSelection
  // target (arrow-key nav into the atom). Tiptap also flags `selected=true`
  // for any range selection that contains the node — including Ctrl+A's
  // AllSelection — and auto-focusing the textarea/input there would steal
  // focus and break select-all/copy. Clicks go through the explicit onClick
  // in each NodeView.
  useEffect(() => {
    if (!selected || editing) return;
    const sel = editor?.state?.selection;
    const pos = typeof getPos === "function" ? getPos() : null;
    if (sel instanceof NodeSelection && pos !== null && sel.from === pos) {
      setEditing(true);
    }
  }, [selected]);

  useEffect(() => {
    if (editing && inputRef.current) {
      // Delay focus so ProseMirror doesn't steal it back
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [editing]);

  useEffect(() => {
    setLatex(node.attrs.latex);
  }, [node.attrs.latex]);

  const save = useCallback(() => {
    updateAttributes({ latex });
    setEditing(false);
  }, [latex, updateAttributes]);

  // Exit: save and move the caret to `pos` in the outer editor so the
  // cursor doesn't vanish when leaving the atom via keyboard. `after:
  // true` places the caret right after the node; false places it right
  // before.
  const exit = useCallback(
    (after: boolean) => {
      updateAttributes({ latex });
      setEditing(false);
      if (typeof getPos === "function" && editor) {
        const base = getPos();
        const pos = after ? base + node.nodeSize : base;
        requestAnimationFrame(() => {
          editor.chain().focus().setTextSelection(pos).run();
        });
      }
    },
    [latex, updateAttributes, editor, getPos, node],
  );

  return { latex, setLatex, editing, setEditing, inputRef, save, exit };
}
