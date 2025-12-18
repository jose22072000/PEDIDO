import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Function to merge class names using clsx and tailwind-merge
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Cross-browser copy to clipboard with multiple fallbacks
export async function copyTextToClipboard(text: string): Promise<boolean> {
  // Method 1: Modern Clipboard API (requires HTTPS or localhost)
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    // Clipboard API failed, try fallbacks
  }

  // Method 2: execCommand with textarea (older browsers)
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    
    // Make it part of the document but invisible
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    textarea.style.width = "2em";
    textarea.style.height = "2em";
    textarea.style.padding = "0";
    textarea.style.border = "none";
    textarea.style.outline = "none";
    textarea.style.boxShadow = "none";
    textarea.style.background = "transparent";
    textarea.setAttribute("readonly", "");
    
    document.body.appendChild(textarea);
    
    // iOS specific handling
    const isIOS = navigator.userAgent.match(/ipad|ipod|iphone/i);
    if (isIOS) {
      textarea.contentEditable = "true";
      textarea.readOnly = false;
      const range = document.createRange();
      range.selectNodeContents(textarea);
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      textarea.setSelectionRange(0, 999999);
    } else {
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
    }

    const successful = document.execCommand("copy");
    document.body.removeChild(textarea);
    
    if (successful) return true;
  } catch (e) {
    // execCommand failed
  }

  // Method 3: Input element fallback (some older Windows browsers)
  try {
    const input = document.createElement("input");
    input.type = "text";
    input.value = text;
    input.style.position = "fixed";
    input.style.top = "-9999px";
    input.style.left = "-9999px";
    input.setAttribute("readonly", "");
    
    document.body.appendChild(input);
    input.focus();
    input.select();
    input.setSelectionRange(0, input.value.length);
    
    const successful = document.execCommand("copy");
    document.body.removeChild(input);
    
    if (successful) return true;
  } catch (e) {
    // Input fallback failed
  }

  return false;
}
