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
const getApiBaseUrl = () => {
  // En desarrollo, usar variable de entorno si existe
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  
  // En producción, construir URL desde el host actual
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    return `${protocol}//${hostname}:8400`;
  }
  
  // Fallback
  return "http://localhost:8400";
};

export const API_BASE_URL = getApiBaseUrl();
