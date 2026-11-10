import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "../Button/Button";
import styles from "./ConfirmDialog.module.scss";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();

    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="confirm-publish-title"
      aria-describedby="confirm-publish-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <div className={styles.body}>
        <div className={styles.iconCircle} aria-hidden="true">
          <AlertTriangle size={22} />
        </div>
        <h2 id="confirm-publish-title" className={styles.title}>
          {title}
        </h2>
        <p id="confirm-publish-description" className={styles.description}>
          {description}
        </p>
        <div className={styles.actions}>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onCancel}
          >
            Скасувати
          </Button>
          <Button
            type="button"
            loading={busy}
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
