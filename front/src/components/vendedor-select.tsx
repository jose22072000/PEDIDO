import { Autocomplete, AutocompleteItem } from "@heroui/react";
import { useMemo, useState } from "react";

import Icons from "./icons/iconify";

export interface VendedorOpcion {
  id: string;
  nombre: string;
  codigo?: string | null;
  /** Cuántos clientes tiene. Sólo lo usa la pantalla de Clientes. */
  clientes?: number | null;
}

/** Sin tildes y en minúsculas, para que "andrés" y "andres" busquen igual. */
const plano = (s: string) =>
  (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Empareja por PRINCIPIO DE PALABRA, no por «contiene en cualquier parte».
 *
 * El filtro que trae HeroUI busca la letra donde sea, y con estos nombres eso es
 * inservible: escribir «l» devolvía javier.franganillo, jose.carlos.hab y josiel.hab
 * —ninguno empieza por l— mezclados con los que sí. Cuantas menos letras escribes, más
 * basura sale, que es justo al revés de como tiene que funcionar un buscador.
 *
 * Los nombres vienen como "leisy.besada" o "jose.carlos.hab", así que el punto cuenta
 * como separador igual que el espacio: escribir «hab» encuentra a jose.carlos.hab, y
 * escribir «besada» encuentra a leisy.besada sin tener que empezar por el nombre.
 */
function empiezaPorPalabra(nombre: string, busca: string): boolean {
  const q = plano(busca).trim();

  if (!q) return true;

  const texto = plano(nombre);

  // Varias palabras sueltas: todas tienen que aparecer. Así "jose hab" reduce de verdad
  // en vez de ensanchar, que es lo que uno espera al seguir escribiendo.
  return q.split(/\s+/).every((parte) =>
    texto.split(/[\s.\-_/]+/).some((palabra) => palabra.startsWith(parte)),
  );
}

/**
 * El selector de vendedor, igual en las cinco pantallas que lo usan.
 *
 * Está aquí y no repetido en cada una porque las dos cosas que lo hacen usable —limpiar
 * el texto al abrirlo y filtrar por principio de palabra— son fáciles de olvidar en la
 * sexta copia, y entonces esa pantalla se comporta distinto sin que nadie sepa por qué.
 */
export function VendedorSelect({
  vendedores,
  value,
  onChange,
  claveTodos = "todos",
  etiquetaTodos = "Todos los vendedores",
  className,
  labelPlacement,
  size = "lg",
  isLoading,
}: {
  vendedores: VendedorOpcion[];
  value: string;
  onChange: (v: string) => void;
  /** Qué id significa "sin filtrar". Unas pantallas usan "todos", otras "all" o "". */
  claveTodos?: string;
  etiquetaTodos?: string;
  className?: string;
  labelPlacement?: "outside" | "outside-left" | "inside";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
}) {
  const opciones = useMemo<VendedorOpcion[]>(
    () => [{ id: claveTodos, nombre: etiquetaTodos }, ...vendedores],
    [vendedores, claveTodos, etiquetaTodos],
  );

  /**
   * El texto de la caja, controlado.
   *
   * Hace falta llevarlo a mano para poder VACIARLO al abrir la lista. Si no, al pulsar
   * te encuentras «Todos los vendedores» escrito y tienes que borrarlo antes de poder
   * teclear — y mientras no lo borras, la lista sale filtrada por ese texto.
   */
  const [texto, setTexto] = useState("");

  const nombreDe = (id: string) =>
    opciones.find((o) => o.id === id)?.nombre ?? "";

  /**
   * El filtrado se hace AQUÍ, no con `defaultFilter`.
   *
   * En cuanto se le pasa `items` a un Autocomplete de HeroUI, la lista es controlada y
   * el componente deja de filtrar: da por hecho que quien manda los items ya los ha
   * filtrado. `defaultFilter` sólo lo aplica con `defaultItems`. Estaba pasando `items`
   * y un `defaultFilter` que no llegaba a ejecutarse nunca, así que escribir «leisy»
   * seguía enseñando la lista entera.
   *
   * `defaultItems` no vale aquí: los vendedores llegan por red después del primer
   * pintado, y una lista no controlada se quedaría con el array vacío del principio.
   */
  const visibles = useMemo(
    () => opciones.filter((o) => empiezaPorPalabra(o.nombre, texto)),
    [opciones, texto],
  );

  return (
    <Autocomplete
      className={className}
      // Sin esto, un texto que no encuentra a nadie cierra la lista y parece que se
      // rompió. Con la lista abierta y vacía se ve que sí buscó y no hay nadie así.
      allowsEmptyCollection
      inputValue={texto}
      isLoading={isLoading}
      items={visibles}
      label="Vendedor"
      labelPlacement={labelPlacement}
      placeholder={etiquetaTodos}
      selectedKey={value}
      size={size}
      startContent={<Icons.workers className="size-5 text-default-400" />}
      variant="bordered"
      onInputChange={setTexto}
      onOpenChange={(abierto) => {
        // Al abrir, la caja se queda limpia para escribir directamente. Al cerrar sin
        // elegir nada, vuelve a enseñar quién está seleccionado — si no, parecería que
        // el filtro se quitó cuando en realidad sigue puesto.
        setTexto(abierto ? "" : nombreDe(value));
      }}
      onSelectionChange={(k) => {
        const id = (k as string) ?? claveTodos;

        onChange(id);
        setTexto(nombreDe(id));
      }}
    >
      {(v: VendedorOpcion) => (
        <AutocompleteItem key={v.id} textValue={v.nombre}>
          {v.nombre}
          {v.codigo ? ` (${v.codigo})` : ""}
          {v.clientes != null ? ` · ${v.clientes}` : ""}
        </AutocompleteItem>
      )}
    </Autocomplete>
  );
}
