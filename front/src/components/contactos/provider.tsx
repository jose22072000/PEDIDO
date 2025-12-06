import React, { useEffect } from "react";

import useContactCatalogStore from "@/stores/contactCatalogStore";

// The project prefers Zustand over Context. This component is a small loader
// that triggers the contact catalog refresh on mount. It intentionally does not
// provide a React Context; consumers should use `useContactCatalogStore` or
// `useContactoStore` directly.
export const ContactosLoader: React.FC<React.PropsWithChildren<{}>> = ({
  children,
}) => {
  const refresh = useContactCatalogStore((s) => s.refresh);

  useEffect(() => {
    // trigger refresh when mounted
    refresh().catch(() => {
      /* ignore */
    });
  }, [refresh]);

  return <>{children}</>;
};

export default ContactosLoader;
