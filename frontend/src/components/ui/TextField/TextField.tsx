import { useId } from "react";

import type { InputHTMLAttributes } from "react";

import styles from "./TextField.module.scss";

interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "size"
> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextField({
  id,
  label,
  hint,
  error,
  className = "",
  required,
  ...props
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  const describedBy =
    [props["aria-describedby"], hint ? hintId : "", error ? errorId : ""]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {label}

        {required && (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        )}
      </label>

      <input
        {...props}
        id={inputId}
        required={required}
        className={[styles.input, error ? styles.invalid : "", className]
          .filter(Boolean)
          .join(" ")}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />

      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}

      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
