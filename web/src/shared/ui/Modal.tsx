// Portal-mounted modal overlay with Escape-to-close, focus trap, and motion animation.
// Portal 弹窗: 支持 Escape 关闭、焦点陷阱和动效动画.
//
// Exports: Modal.
// Callers: AdminModal, account/avatar crop dialogs, any feature that needs a blocking overlay.
//
// Pointer-dismiss invariant: only a press that both starts AND ends on the backdrop counts as
// an outside-click dismiss. This prevents accidental close when the user selects text inside
// the dialog and releases the pointer outside.
// 指针关闭不变式: 仅当按下和释放都在遮罩自身时才关闭, 防止在弹窗内选中文字后释放到外部导致意外关闭.

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { reducedMotionTransition, transitions } from "@/animation/motionPresets";

import { FocusTrap } from "./FocusTrap";

// Modal is a portal-mounted overlay with Esc-to-close + focus trap.
// Modal
// 是带 Esc 关闭和焦点陷阱的 portal 弹窗.
export function Modal({
  isOpen,
  onClose,
  labelledBy,
  children,
}: {
  isOpen: boolean;
  onClose(): void;
  labelledBy: string;
  children: ReactNode;
}): React.ReactPortal {
  // Track whether the pointer press started on the backdrop itself; only then
  // does the resulting click count as an outside-click dismiss. Without this,
  // selecting text inside the modal and releasing outside fires a synthetic
  // click on the LCA (the backdrop) and incorrectly closes the modal.
  const downOnBackdropRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const reduceMotion = useReducedMotion() ?? false;
  const transition = reduceMotion ? reducedMotionTransition : transitions.modalPop;

  return createPortal(
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          className="modal-backdrop"
          onMouseDown={(event) => {
            downOnBackdropRef.current = event.target === event.currentTarget;
          }}
          onMouseUp={(event) => {
            const closeable = downOnBackdropRef.current && event.target === event.currentTarget;
            downOnBackdropRef.current = false;
            if (closeable) onClose();
          }}
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transition}
        >
          <FocusTrap>
            <motion.div
              className="modal-shell"
              role="dialog"
              aria-modal="true"
              aria-labelledby={labelledBy}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={transition}
            >
              {children}
            </motion.div>
          </FocusTrap>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
