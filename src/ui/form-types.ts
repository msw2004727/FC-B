export interface FormFieldProps {
  id?: string;
  name?: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  loading?: boolean;
  success?: boolean;
  describedBy?: string;
  class?: string;
}

export function descriptionIds(
  external: string | undefined,
  ...ids: Array<string | false | undefined>
): string | undefined {
  const result = [external, ...ids].filter(Boolean).join(' ');
  return result || undefined;
}
