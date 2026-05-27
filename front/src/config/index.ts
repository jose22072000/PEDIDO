export const ANIMATIONS = {
  fade: {
    initial: "fadeOut", // Initial animation state
    animate: "fadeIn", // Animation state
    variants: {
      fadeOut: { opacity: 0 }, // Variant for fade out animation
      fadeIn: { opacity: 1 }, // Variant for fade in animation
    },
  },
  "slide-right": {
    initial: "slideIn", // Initial animation state
    animate: "slideOut", // Animation state
    variants: {
      slideIn: { opacity: 0, x: 50 }, // Variant for slide in from right animation
      slideOut: { opacity: 1, x: 0 }, // Variant for slide out to right animation
    },
  },
  "slide-left": {
    initial: "slideIn", // Initial animation state
    animate: "slideOut", // Animation state
    variants: {
      slideIn: { opacity: 0, x: -50 }, // Variant for slide in from left animation
      slideOut: { opacity: 1, x: 0 }, // Variant for slide out to left animation
    },
  },
  "slide-top": {
    initial: "slideIn", // Initial animation state
    animate: "slideOut", // Animation state
    variants: {
      slideIn: { opacity: 0, y: 50 }, // Variant for slide in from top animation
      slideOut: { opacity: 1, y: 0 }, // Variant for slide out to top animation
    },
  },
  "slide-bottom": {
    initial: "slideIn", // Initial animation state
    animate: "slideOut", // Animation state
    variants: {
      slideIn: { opacity: 0, y: -50 }, // Variant for slide in from bottom animation
      slideOut: { opacity: 1, y: 0 }, // Variant for slide out to bottom animation
    },
  },
};

// Construir API URL basada en el host actual del navegador
// Esto permite acceder a la API desde cualquier IP/host sin hardcodear localhost
export const getApiBaseUrl = () => {
  const envUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (envUrl && envUrl.trim()) {
    return envUrl.trim().replace(/\/$/, "");
  }

  const protocol = window.location.protocol;
  const hostname = window.location.hostname;

  return `${protocol}//${hostname}:8400`;
};
