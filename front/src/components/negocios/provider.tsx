import { useEffect } from "react";

import useNegocioCatalogStore from "@/stores/negocioCatalogStore";

export const NegociosLoader: React.FC<React.PropsWithChildren<{}>> = ({
  children,
}) => {
  const updateFilteredItems = useNegocioCatalogStore(
    (s) => s.updateFilteredItems,
  );

  useEffect(() => {
    // Recalcular filtros con los datos actuales al montar
    updateFilteredItems();
    // intentionally run once on mount
  }, []);

  return <>{children}</>;
};

export default NegociosLoader;
