import { toast } from 'sonner';

/**
 * Copy text to clipboard with fallback for non-HTTPS contexts.
 * navigator.clipboard requires secure context (HTTPS/localhost).
 * Falls back to textarea + execCommand for HTTP sites.
 */
export function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard');
      return;
    }

    // Fallback: create a hidden textarea, select, and copy
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    toast.success('Copied to clipboard');
  } catch {
    toast.error('Failed to copy');
  }
}
