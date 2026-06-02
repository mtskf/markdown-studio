import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import type { Editor } from "@tiptap/react";

interface EmbedNode {
  attrs: { url: string; [key: string]: any };
  nodeSize: number;
}

interface UseEmbedEditorReturn {
  url: string;
  setUrl: (value: string) => void;
  editing: boolean;
  setEditing: (value: boolean) => void;
  inputRef: RefObject<HTMLInputElement>;
  save: () => string;
  exit: (after: boolean) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}

// Shared NodeView logic for URL-based embeds (YouTube, GitHub, ...).
// Owns the editing-mode state, focus management, save/cancel semantics,
// and keyboard navigation that escapes the input back into the document.
export function useEmbedEditor(
  node: EmbedNode,
  updateAttributes: (attrs: Record<string, any>) => void,
  deleteNode: () => void,
  editor: Editor | undefined,
  getPos: (() => number) | undefined,
): UseEmbedEditorReturn {
  const [editing, setEditing] = useState(!node.attrs.url);
  const [url, setUrl] = useState<string>(node.attrs.url || "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [editing]);

  useEffect(() => {
    setUrl(node.attrs.url || "");
  }, [node.attrs.url]);

  const save = useCallback((): string => {
    const trimmed = url.trim();
    if (!trimmed) {
      // Empty URL — remove the node entirely so we don't persist a stub.
      deleteNode();
      return "";
    }
    updateAttributes({ url: trimmed });
    setEditing(false);
    return trimmed;
  }, [url, updateAttributes, deleteNode]);

  const exit = useCallback(
    (after: boolean) => {
      // updateAttributes is async — node.attrs.url is still stale here, so
      // guard on the value save() actually committed, not the node snapshot.
      const trimmed = save();
      if (typeof getPos === "function" && editor && trimmed) {
        const base = getPos();
        const pos = after ? base + node.nodeSize : base;
        requestAnimationFrame(() => {
          editor.chain().focus().setTextSelection(pos).run();
        });
      }
    },
    [save, editor, getPos, node],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      const atStart =
        input.selectionStart === 0 && input.selectionEnd === 0;
      const atEnd =
        input.selectionStart === input.value.length &&
        input.selectionEnd === input.value.length;
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        exit(true);
      } else if ((e.key === "ArrowLeft" && atStart) || e.key === "ArrowUp") {
        e.preventDefault();
        exit(false);
      } else if (
        (e.key === "ArrowRight" && atEnd) ||
        e.key === "ArrowDown"
      ) {
        e.preventDefault();
        exit(true);
      }
    },
    [exit],
  );

  return { url, setUrl, editing, setEditing, inputRef, save, exit, onKeyDown };
}
